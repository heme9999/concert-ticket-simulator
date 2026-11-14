export const SITE = {
  brandName: 'StageDrill',
  siteTitle: 'StageDrill',
  baseUrl: 'https://concert-ticket-simulator.pages.dev',
  contactEmail: 'mayday0064@gmail.com',
  googleSiteVerification: 'wMz2VDeMwD8R6yiCgJIqFD_wM2wSzrSEauzvCtzKHyw',
  disclaimerShort:
    'Independent practice simulator using fictional venue data & virtual budgets. Not affiliated with Ticketmaster, Live Nation, or any ticketing provider.',
};

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/practice/', label: 'Practice Arena' },
  { href: '/guides/ticketmaster-training/', label: 'Training Guide' },
  { href: '/guides/seat-selection-practice/', label: 'Seat Strategy' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
];

export const FOOTER_LINKS: readonly NavLink[] = [
  { href: '/', label: 'Simulator Home' },
  { href: '/practice/', label: 'Practice Arena' },
  { href: '/guides/ticketmaster-training/', label: 'Ticketmaster Training Guide' },
  { href: '/guides/seat-selection-practice/', label: 'Seat Selection Guide' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/terms/', label: 'Terms' },
];

export interface SeedPreset {
  seed: string;
  mode: 'quick' | 'scramble' | 'drill';
  difficulty: 'easy' | 'hard' | 'untimed';
  title: string;
  description: string;
}

export const SEED_PRESETS: readonly SeedPreset[] = [
  {
    seed: 'arena-101',
    mode: 'quick',
    difficulty: 'easy',
    title: 'Warmup: Fast Adjacency Scan',
    description: 'Practice spotting adjacent blocks without crossing the center aisle.',
  },
  {
    seed: 'scramble-204',
    mode: 'scramble',
    difficulty: 'easy',
    title: 'Backup Pivot Under Live Demand',
    description: 'Primary section tightens mid-round; adapt quickly to a backup zone.',
  },
  {
    seed: 'encore-909',
    mode: 'scramble',
    difficulty: 'hard',
    title: 'Hard Sprint: Two Surge Waves',
    description: '22-second clock with two availability shifts and tight virtual budget.',
  },
  {
    seed: 'stage-404',
    mode: 'drill',
    difficulty: 'easy',
    title: 'Full Drill: Wait Room to Checkout',
    description: 'Short skippable transition into live seat selection and final confirmation.',
  },
  {
    seed: 'calm-001',
    mode: 'quick',
    difficulty: 'untimed',
    title: 'Untimed Exploration Drill',
    description: 'Zero countdown pressure to learn aisle boundaries, budgets, and keyboard nav.',
  },
];
