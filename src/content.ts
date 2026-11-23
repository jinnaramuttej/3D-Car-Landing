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
  note: "Registration deadline listed as 8 November. Check status on Techfest.org.",
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
      ["S. Somnath", "Former Chairman of ISRO"],
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

/** The one accent colour (CSS, rim lights, the pit lane signage). */
export const theme = {
  accent: '#ff2a1a',
};

export const CONCEPT = 'Unofficial concept';

/** One line per chapter. */
export const chapters: Record<ChapterId, { line: string }> = {
  stillness: { line: 'Midnight on the sea face. Nothing moves but the rain.' },
  ignition: { line: 'One turn of the key, and the city holds its breath.' },
  turn: { line: 'Thirty editions in, we still take the corner sideways.' },
  clearing: { line: 'The rain lifts. The festival comes into view.' },
  arrival: { line: 'Three days at Powai. Bring what you built.' },
  arena: { line: 'Steel walls, orange light, and machines built to hit back.' },
  pitlane: { line: 'Seven competitions. Pick a bay.' },
  voices: { line: 'Presidents, founders, champions and laureates have spoken here.' },
  expo: { line: 'Machines from labs and launchpads, up close.' },
  heartbeat: { line: 'Three minutes and a cheek swab. That is the whole ask.' },
  chamber: { line: 'Eight committees. One question: what is true?' },
  finale: { line: 'The road is open.' },
};

/** First screen: what you can do with the scene. */
export const hints = ['Scroll to drive', 'Hold to rev', 'Move the cursor to wipe the lens', 'Click the car', 'H for headlights'];

export const UI = {
  cta: 'Explore Techfest 2026',
  checkStatus: 'Check status',
  arrival: { kicker: 'V · Arrival' },
  arena: {
    kicker: 'Robowars',
    classLabel: 'Weight class',
    prizeLabel: 'Prize pool',
    zonalsLabel: 'International zonals',
    hint: 'Pick a class. Click the floor for sparks.',
  },
  pitlane: { kicker: 'Pit lane', all: 'All', finale: 'Finale' },
  voices: { kicker: 'Past speakers', hint: 'Hover a marker to see who. Click to pin.' },
  expo: { kicker: 'Expo', hint: 'Click a pedestal for the details.', close: 'Close' },
  heartbeat: { timer: 'About how long the swab takes', start: 'Start three minutes', restart: 'Start again', done: 'Done. That was the whole swab.' },
  chamber: { kicker: 'Model United Nations', hint: 'Hover a card to flip it.' },
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
  hdri: { text: 'Night HDRI "Shanghai Bund" from Poly Haven, CC0', href: 'https://polyhaven.com/a/shanghai_bund' },
};
