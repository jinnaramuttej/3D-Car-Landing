/**
 * ALL SITE COPY. Unofficial concept build: every call to action goes to SITE.home.
 * No organiser phone numbers or emails anywhere, and no external images or logos.
 */

import type { ChapterId } from './lib/chapters';

export const SITE = {
  name: "Techfest 2026",
  edition: "30th Edition",
  dates: "16–18 December 2026",
  venue: "IIT Bombay, Powai, Mumbai",
  home: "https://techfest.org",
  disclaimer: "Unofficial concept build for the Build in 3D challenge.",
};

export const ROBOWARS = {
  prizePool: "₹10,00,000",
  classes: [8, 15, 30, 60], // kg
  stats: [
    { value: "1.5M+", label: "Global livestream views" },
    { value: "25+", label: "International teams" },
    { value: "10K+", label: "Audience" },
  ],
  zonals: ["Mexico", "Tunisia", "Bangladesh"],
  note: "Registration listed to 8 November, check status.",
};

export const COMPETITIONS = [
  { name: "Perceptron Hackathon", tag: "AI", by: "IIT Bombay–Optiver AI Innovation Lab", finale: "15–18 Dec" },
  { name: "National Probability Challenge", tag: "Quant", by: "with Jane Street", prize: "₹3,80,000", finale: "16 Dec" },
  { name: "India @ 71/100 Challenge", tag: "Social Impact", prize: "₹1,00,000", finale: "16–18 Dec" },
  { name: "ZeroCode Vibe Coding Challenge", tag: "AI", finale: "At Techfest" },
  { name: "Meshmerize", tag: "Robotics", blurb: "Autonomous maze-solving line follower" },
  { name: "RoboReach", tag: "Robotics", blurb: "Robotic arm pick-and-place" },
  { name: "ThetaShift", tag: "Robotics", finale: "16–18 Dec" },
]; // each links to SITE.home with "Check status"

export const VOICES = {
  heading: "Voices that have shared the Techfest stage",
  categories: {
    "Political Leaders": [
      ["Dr. A. P. J. Abdul Kalam", "Former President of India"],
      ["Malcolm Turnbull", "Former Prime Minister of Australia"],
      ["Tarja Halonen", "Former President of Finland"],
      ["Ehud Olmert", "Former Prime Minister of Israel"],
    ],
    "Business & Innovation": [
      ["Akash Ambani", "Chairman, Reliance Jio"],
      ["N. R. Narayana Murthy", "Founder of Infosys"],
      ["Andrew Ng", "Co-founder of Google Brain"],
      ["Vint Cerf", "Father of the Internet"],
    ],
    Sports: [
      ["Abhinav Bindra", "Olympic Gold Medalist (Shooting)"],
      ["Viswanathan Anand", "Five Time World Chess Champion"],
      ["Zaheer Khan", "Former Indian Cricketer"],
      ["Neeraj Chopra", "Olympic Gold Medalist (Javelin)"],
    ],
    "Nobel Laureates": [
      ["The 14th Dalai Lama", "Nobel Peace Prize"],
      ["Kurt Wüthrich", "Nobel Prize in Chemistry"],
      ["Amartya Sen", "Nobel Prize in Economics"],
      ["Serge Haroche", "Nobel Prize in Physics"],
    ],
    "Space Pioneers": [
      ["Bill Nelson", "Former Administrator of NASA"],
      ["Rakesh Sharma", "First Indian in Space"],
      ["Gaganyaan Astronauts", "Crew of India's first human spaceflight mission"],
      ["S. Somanath", "Former Chairman of ISRO"],
    ],
  },
};

export const EXPO = {
  heading: "What Techfest has brought to campus",
  exhibits: [
    { name: "Unitree G1", from: "Humanoid robot", blurb: "A next-generation humanoid known for dynamic movement and balance." },
    { name: "SpaceHopper", from: "ETH Zurich", blurb: "A three-legged hopping robot built for low-gravity worlds like asteroids and moons." },
    { name: "Astrobee", from: "NASA", blurb: "A free-flying robot that helps astronauts and runs experiments aboard the ISS." },
    { name: "Proto Hologram", from: "Holographic display", blurb: "Life-sized holograms that let speakers appear remotely in a physical space." },
  ],
};

/** This year's exhibition (the TechExpo stop shows it with the exhibits above). */
export const TECHEXPO = {
  name: "TechExpo",
  pavilion: "Ignite Pavilion",
  line: "International and Indian exhibits, side by side.",
};

export const CATALYST = {
  name: "Catalyst",
  items: [
    { label: "Campus modules", value: "Due 30 Nov 2026" },
    { label: "National Leadership Summit & Pitch", value: "16–18 Dec, IIT Bombay" },
    { label: "National seed fund", value: "₹1,00,000" },
  ],
};

export const ALSO = {
  heading: "Also at Techfest",
  items: [
    { name: "Keynote lectures and speaker sessions" },
    { name: "Hands-on workshops", href: "https://techfest.org/workshops" },
    { name: "Closing performance", where: "Convocation Hall" },
  ],
};

export const CES2027 = {
  name: "CES 2027",
  line: "Official innovation partner of the Motwani Jadeja India Pavilion",
};

export const HEARTBEAT = {
  campaign: "Techfest × DKMS Foundation India",
  headline: "Be someone's only chance at life.",
  body: "Techfest is joining DKMS Foundation India to register 5,000+ students as potential stem cell donors at the main venue and across 10+ zonal city chapters.",
  stats: [
    { value: "5,000+", label: "Potential donors (goal)" },
    { value: "10+", label: "Zonal cities" },
    { value: "3 min", label: "Cheek swab" },
    { value: "100%", label: "Free" },
  ],
};

export const TWMUN = {
  name: "Techfest World MUN",
  tagline: "Veracity Unveiled",
  committees: ["DISEC", "UNCSW", "ICC", "UNFCCC", "UNSC", "ECOFIN", "Lok Sabha", "IPC (International Press)"],
};

/* ------------------------------------------------- copy the scene adds */

/** The one accent colour (CSS, rim lights, the billboards). */
export const theme = {
  accent: '#ff2a1a',
};

export const CONCEPT = 'Unofficial concept';

/** One line per chapter. */
export const chapters: Record<ChapterId, { line: string }> = {
  intro: { line: 'Midnight in the city. Nothing moves but the rain.' },
  robowars: { line: 'Steel, sparks and machines built to hit back.' },
  competitions: { line: 'Seven competitions. Pick a lane.' },
  speakers: { line: 'Presidents, founders and laureates have spoken here. Machines from labs and launchpads have come to campus.' },
  dkms: { line: 'Three minutes and a cheek swab. That is the whole ask.' },
  finale: { line: 'The road is open.' },
};

/** First screen: what you can do with the scene. */
export const hints = ['Scroll to drive', 'Hold to rev', 'Move the cursor to wipe the lens', 'Click the car', 'H for headlights', 'Hold C for the camera'];

export const UI = {
  cta: 'Explore Techfest 2026',
  checkStatus: 'Check status',
  robowars: {
    kicker: 'Robowars',
    classLabel: 'Weight class',
    prizeLabel: 'Prize pool',
    zonalsLabel: 'International zonals',
    hint: 'Pick a class. The billboard follows.',
  },
  competitions: { kicker: 'Competitions', all: 'All', finale: 'Finale', hint: 'Filter. The billboard re-sorts.' },
  speakers: { kicker: 'Past speakers', hint: 'The categories turn over on their own. Pick one to hold it.' },
  expo: { kicker: 'TechExpo', past: 'Past exhibits, brought to campus before', hint: 'Scroll to move along the exhibits.', details: 'Details', close: 'Close' },
  extras: { catalyst: 'Catalyst', also: 'Also at Techfest', ces: 'Partner', more: 'More on techfest.org', workshops: 'Workshops' },
  dkms: { timer: 'About how long the swab takes', start: 'Start three minutes', restart: 'Start again', done: 'Done. That was the whole swab.' },
  more: 'More at Techfest',
};

/** Card backs for the MUN committees. */
export const COMMITTEE_NAMES: Record<string, string> = {
  DISEC: 'Disarmament and International Security Committee',
  UNCSW: 'UN Commission on the Status of Women',
  ICC: 'International Criminal Court',
  UNFCCC: 'UN Framework Convention on Climate Change',
  UNSC: 'UN Security Council',
  ECOFIN: 'Economic and Financial Committee',
  'Lok Sabha': "Lower house of India's Parliament",
  IPC: 'International Press',
};

export const credits = {
  model: { text: 'Porsche 992 GT3 R model by MattDoesBlender, CC BY-NC-SA 4.0', href: 'https://sketchfab.com/3d-models/porsche-992-gt3-r-03ea07f7972648aa9350853b2a1a942a' },
  city: {
    text: '"city" by golukumar (mortalityrexotable), CC BY 4.0, modified (merged, scaled, compressed)',
    href: 'https://sketchfab.com/3d-models/city-2e358ed084524a8f963c146a19637815',
  },
  hdri: { text: 'Night HDRI "Shanghai Bund" from Poly Haven, CC0', href: 'https://polyhaven.com/a/shanghai_bund' },
};
