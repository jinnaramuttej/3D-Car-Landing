/**
 * ALL SITE COPY LIVES HERE. Everything is placeholder: swap in the real fest name,
 * dates, venue, events, schedule, prizes and sponsors.
 */

/** The one neon accent used across the site (CSS, the neon posts and rim light). */
export const theme = {
  accent: '#ff2a1a',
};

export const site = {
  name: 'TECHFEST',
  edition: '2027',
  dates: 'Feb 20 – 22, 2027',
  venue: 'Main Campus Arena, Your College',
  registerUrl: '#register',
};

/** Opening drift (the cold open). */
export const intro = {
  eyebrow: 'Annual Techfest',
  titleTop: 'Feel the',
  titleAccent: 'drift',
  hint: 'Scroll',
};

export const hero = {
  kicker: 'Out of the smoke',
  title: 'TECHFEST',
  edition: '2027',
  primaryCta: { label: 'Register now', href: site.registerUrl },
  secondaryCta: { label: 'Explore events', section: 'events' as const },
};

export const about = {
  kicker: 'About',
  heading: 'Built by students. Tuned for speed.',
  body:
    'Three days where robotics, code and hardware meet the track. Teams from across the country come to build, break and race the things they made. Placeholder copy: tell your story here.',
  stats: [
    { value: 48, prefix: '', suffix: '+', label: 'Events' },
    { value: 12000, prefix: '', suffix: '+', label: 'Participants' },
    { value: 10, prefix: '₹', suffix: 'L', label: 'Prize pool' },
  ],
};

export const events = {
  kicker: 'Events',
  heading: 'Pick your lane',
  items: [
    { title: 'RoboRace', category: 'Robotics', day: 'Day 1', blurb: 'Autonomous bots, one track, no second chances.', prize: '₹1,00,000' },
    { title: 'Hack the Grid', category: 'Coding', day: 'Day 1–2', blurb: '36 hours to ship something the judges can drive.', prize: '₹1,50,000' },
    { title: 'Circuit Sprint', category: 'Electronics', day: 'Day 2', blurb: 'Design, solder and debug against the clock.', prize: '₹60,000' },
    { title: 'Aero Lab', category: 'Design', day: 'Day 2', blurb: 'Wind-tunnel your wing. Least drag wins.', prize: '₹75,000' },
    { title: 'Pit Stop', category: 'Workshop', day: 'Day 3', blurb: 'Hands-on sessions with engineers from industry.', prize: 'Certificates' },
    { title: 'Drift Night', category: 'Showcase', day: 'Day 3', blurb: 'Closing show: lights, smoke and the fastest builds.', prize: 'Glory' },
  ],
};

export const schedule = {
  kicker: 'Schedule',
  heading: 'Three days. Three nights.',
  /** One neon post on the track per day: the item lights up as the camera passes it. */
  days: [
    { day: 'Day 1', date: 'Fri, Feb 20', items: ['Opening ceremony', 'RoboRace heats', 'Hack the Grid kicks off'] },
    { day: 'Day 2', date: 'Sat, Feb 21', items: ['Circuit Sprint', 'Aero Lab finals', 'Night build sessions'] },
    { day: 'Day 3', date: 'Sun, Feb 22', items: ['Pit Stop workshops', 'Prize ceremony', 'Drift Night'] },
  ],
};

export const prizes = {
  kicker: 'Prizes',
  heading: 'Light it up',
  tiers: [
    { name: 'Grand Prix', amount: '₹3,00,000', perks: ['Winner trophy', 'Internship fast-track', 'Track day pass'] },
    { name: 'Podium', amount: '₹1,50,000', perks: ['Medals', 'Mentorship sessions', 'Swag kit'] },
    { name: 'Pit Crew', amount: '₹50,000', perks: ['Certificates', 'Sponsor goodies', 'Finalist badge'] },
  ],
  sponsorsHeading: 'Powered by',
  /** Wordmarks for now. Add `logo: '/sponsors/name.svg'` to show an image instead. */
  sponsors: [
    { name: 'Northwind' },
    { name: 'Apex Labs' },
    { name: 'Voltline' },
    { name: 'Kinetic' },
    { name: 'Pitlane' },
    { name: 'Ionic' },
    { name: 'Redline Co' },
    { name: 'Gridworks' },
  ] as { name: string; logo?: string }[],
};

export const finale = {
  kicker: 'Lights out',
  heading: 'Ready. Set. Launch.',
  body: 'Registrations close soon.',
  cta: { label: 'Register now', href: site.registerUrl },
};

/** Navbar labels (the order follows the sections). */
export const nav = {
  hero: 'Home',
  about: 'About',
  events: 'Events',
  schedule: 'Schedule',
  prizes: 'Prizes',
  finale: 'Register',
} as const;
