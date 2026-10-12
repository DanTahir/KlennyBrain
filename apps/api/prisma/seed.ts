/**
 * Development seed for KlennyBrain.
 *
 * Creates the fictional "Northwind Robotics" organization from the demo story
 * bible (`data/demo/company.json`): four login personas, a DirectoryPerson row
 * for every employee (used for ACL groups and "view as"), and the BrainSpace
 * that maps the org to its HydraDB database. Knowledge itself is ingested at
 * runtime via the "Load demo company" button (POST /brain/demo).
 *
 * Idempotent: records upsert on their natural keys.
 *
 *   pnpm --filter @app-starter/api prisma:seed
 */
import { PrismaClient, OrgRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Run directly via ts-node, so nothing else has loaded the env yet. Mirrors
// the order in prisma.config.ts: tests read .env.test, everything else .env.
const apiRoot = path.resolve(__dirname, '..');
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: path.join(apiRoot, '.env.test.local') });
  dotenv.config({ path: path.join(apiRoot, '.env.test') });
} else {
  dotenv.config({ path: path.join(apiRoot, '.env') });
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env first.');
}

// The demo accounts use a password published in this file and in the README,
// and the CEO persona is a global admin. Refuse to seed production by default.
if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  throw new Error(
    'Refusing to seed with NODE_ENV=production: the demo accounts have a publicly known password. ' +
      'Set SEED_ALLOW_PRODUCTION=true if you really mean it.',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEMO_PASSWORD = 'Password123!';
const ORG_SLUG = 'northwind';

interface BiblePerson {
  id: string;
  name: string;
  email: string;
  slackId: string;
  title: string;
  department: string;
  manager: string | null;
  groups: string[];
  expertise: string[];
}

interface Bible {
  company: { name: string; domain: string; description?: string };
  people: BiblePerson[];
}

/** People who can sign in, with their organization role. */
const LOGIN_PERSONAS: { id: string; role: OrgRole; globalAdmin?: boolean; label: string }[] = [
  { id: 'elena', role: OrgRole.OWNER, globalAdmin: true, label: 'CEO, sees #leadership' },
  { id: 'jordan', role: OrgRole.ADMIN, label: 'engineering lead' },
  { id: 'marco', role: OrgRole.MEMBER, label: 'support agent' },
  { id: 'ollie', role: OrgRole.MEMBER, label: 'engineering intern' },
];

function loadBible(): Bible {
  const dataDir = process.env.DEMO_DATA_DIR
    ? path.resolve(process.env.DEMO_DATA_DIR)
    : path.resolve(apiRoot, '..', '..', 'data', 'demo');
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'company.json'), 'utf8')) as Bible;
}

/** Removes the upstream app-starter demo (Acme) if an older seed created it. */
async function removeStarterDemo() {
  await prisma.organization.deleteMany({ where: { slug: 'acme' } });
  try {
    await prisma.user.deleteMany({ where: { email: { in: ['owner@example.com', 'member@example.com'] } } });
  } catch (error) {
    console.warn('Could not remove the old example.com demo users:', (error as Error).message);
  }
}

async function seedNorthwind() {
  const bible = loadBible();
  const byId = new Map(bible.people.map((person) => [person.id, person]));
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: bible.company.name },
    create: {
      name: bible.company.name,
      slug: ORG_SLUG,
      description: bible.company.description?.slice(0, 500) ?? null,
      website: `https://${bible.company.domain}`,
      location: 'Oakland, CA',
      timezone: 'America/Los_Angeles',
    },
  });

  for (const person of bible.people) {
    const data = {
      personKey: person.id,
      name: person.name,
      title: person.title,
      department: person.department,
      managerEmail: person.manager ? (byId.get(person.manager)?.email ?? null) : null,
      groups: person.groups,
      slackUserId: person.slackId,
      expertise: person.expertise ?? [],
    };
    await prisma.directoryPerson.upsert({
      where: { organizationId_email: { organizationId: organization.id, email: person.email } },
      update: data,
      create: { ...data, organizationId: organization.id, email: person.email },
    });
  }

  for (const persona of LOGIN_PERSONAS) {
    const person = byId.get(persona.id);
    if (!person) throw new Error(`Persona ${persona.id} is missing from company.json`);
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, emailVerifiedAt: new Date(), isGlobalAdmin: Boolean(persona.globalAdmin) },
      create: {
        email: person.email,
        password: passwordHash,
        name: person.name,
        username: person.id,
        emailVerifiedAt: new Date(),
        isGlobalAdmin: Boolean(persona.globalAdmin),
        timezone: 'America/Los_Angeles',
      },
    });
    await prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { role: persona.role },
      create: { userId: user.id, organizationId: organization.id, role: persona.role },
    });
  }

  await prisma.brainSpace.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id, hydraDatabase: `brain_${ORG_SLUG}`, collection: 'default' },
  });

  console.log(`Seeded "${organization.name}" (${bible.people.length} directory people) — sign in with:`);
  for (const persona of LOGIN_PERSONAS) {
    const person = byId.get(persona.id)!;
    console.log(`  ${person.email.padEnd(24)} / ${DEMO_PASSWORD}  ${persona.role.padEnd(6)} ${persona.label}`);
  }
}

async function main() {
  await removeStarterDemo();
  await seedNorthwind();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
