/**
 * Every tunable for the scene lives here.
 *
 * Components read CONFIG inside useFrame, so the leva panel (open the page with
 * `?debug`) edits these values live without re-rendering React. When you like a
 * setup, press "copy config" in the panel and paste the JSON back over this object.
 *
 * Values marked (mount) are read once when the scene mounts; reload after changing them.
 */
export const CONFIG = {
  scroll: {
    lenisLerp: 0.09, // (mount) Lenis smoothing, lower = floatier
  },

  /**
   * The journey driver (src/lib/chapterRuntime.ts): what is on screen chases the scroll with
   * a speed and acceleration limit, so any jump is a fast, continuous drive.
   */
  drive: {
    maxSpeed: 110, // m/s: the car never drives faster than this to catch the scroll up
    maxRate: 0.25, // journey (0..1) per second at most (where the car is parked or creeping)
    maxAccel: 0.42, // journey per second per second
    settle: 0.12, // seconds; the last bit of a move eases in like a damped spring
  },

  /** The camera director (src/scene/city/director.ts). */
  director: {
    blendMin: 1.2, // seconds for the smallest move between two rigs...
    blendMax: 2, // ...and for the biggest (round to the other side of the car)
  },

  /** The Play button: the whole journey by itself. */
  autoplay: {
    seconds: 150, // total length
  },

  /** The car's slides: the big one in chapter III (src/lib/cityDrive.ts sets where). */
  drift: {
    yawPeakDeg: 38,
    slipRefDeg: 34, // yaw that counts as "full slip" for smoke, skids and shake
    rollDeg: 4, // body roll away from the turn at full slip
    counterSteerDeg: 24, // front wheels steer against the slide
    widen: 1.6, // metres the car slides toward the outside at full slip
    pivotZ: 0.9, // yaw pivot in metres ahead of the car centre (tail swings, nose holds the line)
    yawSmooth: 0.2,
    rollSmooth: 0.28,
    steerSmooth: 0.12,
    rearSpinBoost: 55, // extra rad/s on the rear wheels at full slip
    vibration: 0.006, // body buzz in metres at full slip
  },

  car: {
    headlightEmissive: 7,
    tailLightEmissive: 5,
    brakeBoost: 1.6, // tail lights brighten by this factor at full slip or under braking
    headBeam: 110, // spot light intensity of each headlight
    headBeamAngle: 0.5,
    tailGlow: 1.2, // red point light behind the car
    paintEnv: 0.85, // envMapIntensity on the bodywork (absolute, not scaled by the chapter's env level)
    paintRoughness: 0.25,
    paintMetalness: 0.6,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    glassTint: '#b4c3cc', // slight cool tint on the transmissive windows
    glassRoughness: 0.04,
    glassEnv: 1.3,
    tyreColor: '#7a7a7a', // multiplies the tyre texture: dark rubber
    tyreRoughness: 0.9,
    tyreSpecular: 0.25,
    tyreEnv: 0.35,
    contactOpacity: 0.85, // (mount) drei ContactShadows under the car
    contactBlur: 2.4, // (mount)
    rimColor: '#1c1d21',
    caliperColor: '#c8161d',
    rimBlurFrom: 14, // wheel rad/s where the motion-blur disc starts to show
    rimBlurTo: 40,
  },

  /** Global camera knobs. The rigs themselves are in src/scene/city/director.ts. */
  camera: {
    fovMin: 24, // long-lens rule: vertical FOV is clamped to [fovMin, fovMax]
    fovMax: 40, // (wider requests pull the camera back to keep the framing)
    fovScale: 1, // multiplies every shot's FOV
    shakePeak: 0.07, // metres of shake at full slip
    shakeRollDeg: 0.7,
    shakeSpeed: 1,
    handheld: 0.02, // metres of slow float at handheld = 1
    dofScale: 1, // multiplies every shot's bokeh (0 = depth of field off)
    portraitFit: 0.75, // camera pulls back by (1/aspect)^portraitFit on portrait screens
    parallax: 0.25, // metres of mouse parallax (desktop)
  },

  smoke: {
    maxParticles: 1200, // (mount) halved on mobile
    rate: 30, // particles/s per rear wheel at full slip
    floor: 0.3, // while the car slides at all, never less than this share of the rate
    lifeMin: 6, // the wake hangs in the street for 6-8 s
    lifeMax: 8,
    sizeStart: 0.9,
    sizeEnd: 6.5,
    opacity: 0.16, // big, faint puffs: density comes from many of them overlapping
    soft: 1.4, // how softly a puff fades into whatever it meets (x 0.4-1 m by puff size)
    wind: 0.45, // how much of the rain's wind carries the smoke
    lampLit: 0.3, // how much the street lamps light the smoke
    rise: 0.32, // m/s^2 the wake rises once it has warmed (after a second or two)...
    settle: 0.12, // ...and the slight settle that keeps it on the road before that
    shear: 1, // how much more the wind carries it the higher it gets
    drag: 1.1,
    noise: 1.2,
    kick: 2.2, // sideways throw toward the outside of the turn
    color: '#6f7680',
    tailTint: 0.2, // how much the tail lights paint nearby smoke red
    headLit: 0.85, // how strongly the headlight beams light the smoke and spray
    sprayRate: 26, // wet-road spray per rear wheel at speed (scaled by rain.intensity)
    spraySize: 0.28,
    sprayOpacity: 0.55,
  },

  skid: {
    opacity: 0.55,
    width: 0.3,
    minSlip: 0.15,
  },

  /** Rain: streaks around the camera, splashes around the car, haze in the headlight beams. */
  rain: {
    count: 6300, // (mount) streaks in the box around the camera
    splashCount: 700, // (mount)
    mobileScale: 0.3, // (mount) phones get this fraction of streaks and splashes
    intensity: 1, // 0 = dry
    streakOpacity: 0.7, // how strongly each streak shows (the chapters set how hard it rains)
    fallSpeed: 9, // m/s
    windX: 2.4, // m/s, slants the streaks
    windZ: 0.9,
    streakLength: 0.6, // metres (fall speed x a cinema shutter, stretched for the look)
    streakWidth: 0.007,
    boxSize: 30, // metres of rain kept around the camera
    boxHeight: 16,
    nearFade: 0.35, // streaks fade out this close to the lens (metres)
    color: '#9db3c9',
    ambient: 0.32, // city glow on the drops
    headGain: 5, // extra glow inside the headlight beams
    tailGain: 0.8, // red glow from the tail lights
    splashLife: 0.38, // seconds
    splashRadius: 11, // metres around the car
    splashSize: 0.09,
    splashOpacity: 0.35,
    beamOpacity: 0.05, // haze cone in front of each headlight
    beamLength: 16,
  },

  /** Visitor input (src/scene/Interaction.tsx). */
  interaction: {
    revRise: 0.12, // seconds to wind up while held
    revFall: 0.45, // seconds to settle after release
    holdDelay: 0.16, // seconds a press must last before it revs (a click picks the car)
    revShake: 0.035, // metres of camera shake at full rev
    revVibration: 0.012, // body buzz at full rev
    revRain: 1, // how hard the rain reacts to a rev (splashes, jitter, lens drops)
    parallaxDrift: 0.5, // mouse parallax during the drift, relative to camera.parallax
    wipeRadius: 0.06, // lens wipe brush, in screen heights
    wipeReturn: 0.15, // how fast the drops come back (per second, scaled by the rain)
    liveryTime: 0.6, // seconds to change livery
  },

  /** The city, the sea and the bridge (src/scene/city). */
  city: {
    sodium: '#ffa24d', // street lamp colour
    sodiumEmissive: 7,
    waveSpeed: 0.015,
    driftYawDeg: 30, // drift angle at full slide in the corners after the stops begin
    driftFrom: 7, // lateral acceleration (m/s^2, at a steady scroll) where a corner starts to slide
    driftFull: 16, // ... and where it is fully sideways
    showRoute: false, // draw the route, its waypoints and the stops (debug)
    nightAlbedo: 0.42, // how dark the city's surfaces are at night (1 = daylight textures)
    windowGlow: 1.1, // lit windows
    signGlow: 2.4, // shop fronts and neon
    ledGlow: 5, // the LED palms and trees
    puddles: 1, // puddle coverage on the wet roads
    reflection: 1, // wet-street reflection strength (desktop)
    reflectionScale: 0.5, // (mount-ish) reflection resolution, fraction of the canvas width
    lampLight: 260, // each of the real sodium lights that follow the camera
    lampShafts: 0.14, // the cone of light under each lamp, in the rain
    billboardGlow: 2.2, // LED billboard brightness (blooms above ~1)
    billboardLight: 420, // the light the active billboard spills on the street
    heartbeatBpm: 56, // the DKMS billboard's slow pulse
  },

  /** Post chain (src/scene/Effects.tsx). Mobile skips DOF, motion blur, streaks and lens drops. */
  post: {
    focusOnCar: true, // during the drift, keep the car in focus even when the shot looks past it
    motionBlur: 0.45, // share of each frame's motion that gets smeared (0.5 ~ 180 degree shutter)
    motionBlurMax: 0.025, // longest smear, in screen heights
    motionBlurSamples: 8, // (mount)
    streaks: 1, // light-speed streaks when the car is flat out (60-105 m/s)
    cutDistance: 2.5, // metres the camera jumps in one frame that count as a cut (no blur that frame)
    anamorphic: 0.5, // horizontal lens streaks on the brightest lights
    anamorphicThreshold: 2.2, // HDR level where the streaks start
    anamorphicLength: 1,
    anamorphicTint: '#7fb0ff',
    grade: 0.55, // teal/orange LUT strength (restrained)
    grain: 0.35, // film grain, strongest in the midtones
    lensDrops: 0.75, // rain drops on the lens (scaled by rain.intensity)
    lensDropRefract: 0.035,
    lensDropStreak: 0.09, // how far camera motion stretches the drops
  },

  look: {
    background: '#04050a',
    bloomIntensity: 0.95,
    bloomThreshold: 0.9,
    bloomSmoothing: 0.25,
    chromaticOffset: 0.0006,
    chromaticShake: 0.0025, // extra aberration at shake peak
    vignetteOffset: 0.28,
    vignetteDarkness: 0.64,
    reflection: 25, // MeshReflectorMaterial mixStrength: how wet the asphalt looks
    reflectionBlur: 1, // mixBlur: how much rough patches smear the reflection
    lampEmissive: 6,
  },
};

export type Config = typeof CONFIG;

type Range = readonly [min: number, max: number, step?: number];

/** Slider ranges for the leva panel. Anything missing gets a plain number field. */
export const RANGES: { [G in keyof Config]?: { [K in keyof Config[G]]?: Range } } = {
  drive: { maxSpeed: [10, 400, 1], maxRate: [0.02, 2, 0.01], maxAccel: [0.02, 4, 0.01], settle: [0.01, 1, 0.01] },
  director: { blendMin: [0.2, 4, 0.05], blendMax: [0.2, 4, 0.05] },
  autoplay: { seconds: [30, 600, 5] },
  drift: {
    yawPeakDeg: [0, 60, 0.5],
    slipRefDeg: [5, 60, 0.5],
    rollDeg: [0, 10, 0.1],
    counterSteerDeg: [0, 40, 0.5],
    widen: [0, 4, 0.05],
    pivotZ: [-2, 2.4, 0.05],
    yawSmooth: [0, 1, 0.01],
    rollSmooth: [0, 1, 0.01],
    steerSmooth: [0, 1, 0.01],
    rearSpinBoost: [0, 150, 1],
    vibration: [0, 0.03, 0.001],
  },
  car: {
    headlightEmissive: [0, 30, 0.1],
    tailLightEmissive: [0, 30, 0.1],
    brakeBoost: [0, 5, 0.05],
    headBeam: [0, 400, 1],
    headBeamAngle: [0.1, 1.2, 0.01],
    tailGlow: [0, 20, 0.1],
    paintEnv: [0, 4, 0.05],
    paintRoughness: [0, 1, 0.01],
    paintMetalness: [0, 1, 0.01],
    clearcoat: [0, 1, 0.01],
    clearcoatRoughness: [0, 1, 0.01],
    glassRoughness: [0, 0.5, 0.01],
    glassEnv: [0, 4, 0.05],
    tyreRoughness: [0, 1, 0.01],
    tyreSpecular: [0, 1, 0.01],
    tyreEnv: [0, 2, 0.01],
    contactOpacity: [0, 1, 0.01],
    contactBlur: [0, 6, 0.1],
  },
  camera: {
    fovMin: [10, 40, 0.5],
    fovMax: [24, 70, 0.5],
    fovScale: [0.5, 1.5, 0.01],
    shakePeak: [0, 0.3, 0.005],
    shakeRollDeg: [0, 4, 0.05],
    shakeSpeed: [0, 3, 0.05],
    handheld: [0, 0.1, 0.001],
    dofScale: [0, 3, 0.05],
    portraitFit: [0, 1.5, 0.01],
    parallax: [0, 1, 0.01],
  },
  smoke: {
    rate: [0, 150, 1],
    floor: [0, 1, 0.01],
    soft: [0, 6, 0.05],
    wind: [0, 2, 0.01],
    lampLit: [0, 3, 0.01],
    lifeMin: [0.5, 12, 0.1],
    lifeMax: [0.5, 12, 0.1],
    sizeStart: [0.1, 4, 0.05],
    sizeEnd: [0.5, 12, 0.1],
    opacity: [0, 1, 0.01],
    rise: [-1, 2, 0.01],
    settle: [0, 1, 0.01],
    shear: [0, 3, 0.01],
    drag: [0, 5, 0.05],
    noise: [0, 5, 0.05],
    kick: [0, 8, 0.1],
    tailTint: [0, 2, 0.05],
    headLit: [0, 8, 0.05],
    sprayRate: [0, 120, 1],
    spraySize: [0.05, 1.5, 0.01],
    sprayOpacity: [0, 1.5, 0.01],
  },
  skid: { opacity: [0, 1, 0.01], width: [0.05, 0.8, 0.01], minSlip: [0, 1, 0.01] },
  rain: {
    intensity: [0, 2, 0.01],
    streakOpacity: [0, 2, 0.01],
    fallSpeed: [1, 20, 0.1],
    windX: [-8, 8, 0.1],
    windZ: [-8, 8, 0.1],
    streakLength: [0.05, 2, 0.01],
    streakWidth: [0.001, 0.03, 0.0005],
    boxSize: [8, 80, 1],
    boxHeight: [4, 40, 1],
    nearFade: [0, 3, 0.01],
    ambient: [0, 2, 0.01],
    headGain: [0, 20, 0.1],
    tailGain: [0, 5, 0.05],
    splashLife: [0.1, 1.5, 0.01],
    splashRadius: [1, 30, 0.5],
    splashSize: [0.02, 0.6, 0.01],
    splashOpacity: [0, 2, 0.01],
    beamOpacity: [0, 0.5, 0.005],
    beamLength: [2, 40, 0.5],
  },
  city: {
    sodiumEmissive: [0, 20, 0.1],
    waveSpeed: [0, 0.1, 0.001],
    driftYawDeg: [0, 50, 0.5],
    driftFrom: [0, 40, 0.5],
    driftFull: [1, 60, 0.5],
    nightAlbedo: [0.05, 1, 0.01],
    windowGlow: [0, 8, 0.05],
    signGlow: [0, 8, 0.05],
    ledGlow: [0, 15, 0.1],
    puddles: [0, 1.5, 0.01],
    reflection: [0, 3, 0.01],
    reflectionScale: [0.2, 1, 0.05],
    lampLight: [0, 1500, 5],
    lampShafts: [0, 0.5, 0.005],
    billboardGlow: [0, 8, 0.05],
    billboardLight: [0, 3000, 10],
    heartbeatBpm: [30, 120, 1],
  },
  interaction: {
    revRise: [0.01, 1, 0.01],
    revFall: [0.01, 2, 0.01],
    holdDelay: [0, 0.6, 0.01],
    revShake: [0, 0.2, 0.001],
    revVibration: [0, 0.05, 0.001],
    revRain: [0, 3, 0.05],
    parallaxDrift: [0, 1, 0.01],
    wipeRadius: [0.01, 0.2, 0.005],
    wipeReturn: [0, 2, 0.01],
    liveryTime: [0.05, 3, 0.05],
  },
  post: {
    motionBlur: [0, 1.5, 0.01],
    motionBlurMax: [0, 0.1, 0.001],
    streaks: [0, 2, 0.01],
    cutDistance: [0.2, 10, 0.1],
    anamorphic: [0, 3, 0.01],
    anamorphicThreshold: [0, 10, 0.05],
    anamorphicLength: [0.2, 3, 0.05],
    grade: [0, 1, 0.01],
    grain: [0, 1, 0.01],
    lensDrops: [0, 2, 0.01],
    lensDropRefract: [0, 0.15, 0.001],
    lensDropStreak: [0, 0.5, 0.005],
  },
  look: {
    bloomIntensity: [0, 4, 0.05],
    bloomThreshold: [0, 3, 0.01],
    bloomSmoothing: [0, 1, 0.01],
    chromaticOffset: [0, 0.01, 0.0001],
    chromaticShake: [0, 0.02, 0.0001],
    vignetteOffset: [0, 1, 0.01],
    vignetteDarkness: [0, 1.5, 0.01],
    reflection: [0, 150, 0.5],
    reflectionBlur: [0, 10, 0.05],
    lampEmissive: [0, 20, 0.1],
  },
};
