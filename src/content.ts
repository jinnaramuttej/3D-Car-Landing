/**
 * ALL SITE COPY. Unofficial concept build: every call to action goes to techfest.org.
 * Event names, partners, dates and prize figures are as listed for Techfest 2026; check
 * them against techfest.org before showing this to anyone as fact.
 */

import type { ChapterId } from './lib/chapters';

/** The one accent colour (CSS, the rim light, the billboards). */
export const theme = {
  accent: '#ff2a1a',
};

export const site = {
  name: 'Techfest',
  year: '2026',
  edition: '30th edition',
  dates: 'Dec 16–18, 2026',
  venue: 'IIT Bombay, Powai, Mumbai',
  campus: 'IIT Bombay campus, Powai, Mumbai',
  est: 'Est. 1998',
  claim: "Asia's largest science and technology festival",
  url: 'https://techfest.org',
  concept: 'Unofficial concept',
  disclaimer: 'Unofficial concept build for the Build in 3D challenge.',
};

/** One line per chapter. */
export const chapters: Record<ChapterId, { line: string }> = {
  stillness: { line: 'Midnight on the sea face. Nothing moves but the rain.' },
  ignition: { line: 'One turn of the key, and the city holds its breath.' },
  turn: { line: 'Thirty editions in, we still take the corner sideways.' },
  clearing: { line: 'The rain lifts. The festival comes into view.' },
  arrival: { line: 'Three days at Powai. Bring what you built.' },
};

/** First screen: what you can do with the scene. */
export const hints = ['Scroll to drive', 'Hold to rev', 'Move the cursor to wipe the lens', 'Click the car', 'H for headlights'];

/** Chapter IV: the title that forms as the smoke clears. */
export const title = {
  word: 'Techfest',
  year: '2026',
  meta: [site.edition, site.dates, site.venue],
  cta: 'Explore Techfest 2026',
};

/** Chapter V opener. */
export const arrival = {
  kicker: 'V · Arrival',
  facts: [
    { label: 'What', value: site.claim },
    { label: 'When', value: site.dates },
    { label: 'Where', value: site.campus },
    { label: 'Since', value: '1998, now in its 30th edition' },
  ],
};

/** The dashboard. Values count up; `decimals` keeps the 4.8. */
export const numbers = {
  kicker: 'Dashboard',
  heading: 'Read the gauges.',
  items: [
    { value: 30, prefix: '', suffix: 'th', decimals: 0, label: 'Edition', max: 30 },
    { value: 3, prefix: '', suffix: '', decimals: 0, label: 'Days on campus', max: 3 },
    { value: 7, prefix: '', suffix: '', decimals: 0, label: 'Featured challenges', max: 7 },
    { value: 4.8, prefix: '₹', suffix: 'L', decimals: 1, label: 'Across two listed prize pools', max: 4.8 },
    { value: 1998, prefix: '', suffix: '', decimals: 0, label: 'Running since', max: 1998, plain: true },
  ],
};

export type EventTag = 'AI' | 'Maths' | 'Ideas' | 'Code' | 'Robotics';

/** The pit lane: one garage bay per featured challenge. */
export const pitlane = {
  kicker: 'Pit lane',
  heading: 'Seven bays. Pick your machine.',
  filters: ['All', 'AI', 'Maths', 'Ideas', 'Code', 'Robotics'] as const,
  status: 'Check status on Techfest.org',
  bays: [
    {
      name: 'Perceptron Hackathon',
      tag: 'AI' as EventTag,
      with: 'IIT Bombay–Optiver AI Innovation Lab',
      line: 'Teach the machine. Beat the clock.',
    },
    {
      name: 'National Probability Challenge',
      tag: 'Maths' as EventTag,
      with: 'with Jane Street',
      prize: '₹3.8 lakh',
      line: 'Odds, estimates and nerve.',
    },
    {
      name: 'India @ 71/100 Challenge',
      tag: 'Ideas' as EventTag,
      prize: '₹1 lakh',
      line: 'Ideas for where the country goes next.',
    },
    {
      name: 'ZeroCode Vibe Coding Challenge',
      tag: 'Code' as EventTag,
      line: 'Describe it. Ship it.',
    },
    {
      name: 'Meshmerize',
      tag: 'Robotics' as EventTag,
      line: 'A line follower that maps the maze, then runs it shortest.',
    },
    {
      name: 'RoboReach',
      tag: 'Robotics' as EventTag,
      line: 'A robotic arm. Pick, place, faster.',
    },
    {
      name: 'ThetaShift',
      tag: 'Robotics' as EventTag,
      line: 'Spherical bots that roll where you tell them.',
    },
  ],
};

/** Three mile markers down the road, one per day. */
export const schedule = {
  kicker: 'The road',
  heading: 'Three markers. Three days.',
  days: [
    { date: 'Dec 16', day: 'Day 1', line: 'Lights on.' },
    { date: 'Dec 17', day: 'Day 2', line: 'Flat out.' },
    { date: 'Dec 18', day: 'Day 3', line: 'Last lap.' },
  ],
};

/** Roadside billboards (text only, no logos). */
export const partners = {
  kicker: 'Roadside',
  heading: 'The names behind the featured challenges.',
  boards: [
    { name: 'IIT Bombay–Optiver AI Innovation Lab', line: 'Perceptron Hackathon' },
    { name: 'Jane Street', line: 'National Probability Challenge' },
    { name: 'Techfest 2026', line: 'Partner with the festival · techfest.org' },
  ],
};

export const finale = {
  line: 'The road is open.',
  cta: 'Explore Techfest 2026',
  sub: 'Everything official lives on techfest.org.',
};

export const credits = {
  model: { text: 'Porsche 992 GT3 R model by MattDoesBlender, CC BY-NC-SA 4.0', href: 'https://sketchfab.com/3d-models/porsche-992-gt3-r-03ea07f7972648aa9350853b2a1a942a' },
  hdri: { text: 'Night HDRI "Shanghai Bund" from Poly Haven, CC0', href: 'https://polyhaven.com/a/shanghai_bund' },
};
