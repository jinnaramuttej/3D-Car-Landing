/**
 * Every tunable for the scene lives here.
 *
 * Components read CONFIG inside useFrame, so the leva panel (open the page with
 * `?debug`) edits these values live without re-rendering React. When you like a
 * setup, press "copy config" in the panel and paste the JSON back over this object.
 *
 * Values marked (mount) are read once when the scene mounts; reload after changing them.
 * Values in `track` rebuild the path on the fly.
 */
export const CONFIG = {
  scroll: {
    lenisLerp: 0.09, // (mount) Lenis smoothing, lower = floatier
    progressSmooth: 0.12, // seconds; maath damp applied to progress before anything reads it
  },

  /**
   * Centre line of the road: lead straight, bend A (the cold-open slide), a straight,
   * bend B (the main drift), exit straight. Degrees: positive = left, negative = right.
   * The car starts `startInto` metres into bend A and stops at the end of `straightOut`.
   */
  track: {
    lead: 80, // road behind bend A (only ever seen, never driven)
    arcARadius: 28,
    arcADeg: -50,
    startInto: 8,
    straightMid: 56,
    arcBRadius: 35,
    arcBDeg: 100,
    straightOut: 48,
    tail: 160, // road visible after the car's last position
    halfWidth: 7.5,
  },

  /** Cold-open slide through bend A: already sideways when the page loads. */
  introDrift: {
    start: -0.02,
    peakAt: 0,
    holdUntil: 0.04,
    end: 0.12,
    yawPeakDeg: 30,
  },

  /** Main drift through bend B. Yaw direction follows each bend. */
  drift: {
    start: 0.4, // yaw starts building (the tyre shot)
    peakAt: 0.5, // full yaw reached
    holdUntil: 0.64, // yaw held
    end: 0.72, // back to straight
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
    brakeAt: 0.37, // brake flare before turn-in (seen in the tail shot)
    brakeWidth: 0.025,
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

  /** Global camera knobs. The shots themselves (framing, cuts, timing) are in src/lib/script.ts. */
  camera: {
    fovMin: 24, // long-lens rule: vertical FOV is clamped to [fovMin, fovMax]
    fovMax: 40, // (wider requests pull the camera back to keep the framing)
    fovScale: 1, // multiplies every shot's FOV
    anchorP: 0.62, // where along the path the final shot is anchored (the smoke cloud)
    shakePeak: 0.07, // metres, at shakeAt and full slip
    shakeAt: 0.56,
    shakeWidth: 0.075, // width of the bell around shakeAt
    shakeRollDeg: 0.7,
    shakeSpeed: 1,
    handheld: 0.02, // metres of slow float at handheld = 1
    dofScale: 1, // multiplies every shot's bokeh (0 = depth of field off)
    portraitFit: 0.75, // camera pulls back by (1/aspect)^portraitFit on portrait screens
    sectionSmooth: 0.45, // seconds; maath damp on the camera between section waypoints
    parallax: 0.25, // metres of mouse parallax in the sections (desktop)
  },

  smoke: {
    maxParticles: 400, // (mount) halved on mobile
    rate: 10, // particles/s per rear wheel at full slip (was 34: low tyre smoke, not a wall)
    lifeMin: 1.4,
    lifeMax: 2.8,
    sizeStart: 0.45,
    sizeEnd: 3.2,
    opacity: 0.3,
    rise: 0.15, // stays low over the asphalt
    drag: 1.1,
    noise: 1.2,
    kick: 2.2, // sideways throw toward the outside of the turn
    color: '#6f7680',
    tailTint: 0.2, // how much the tail lights paint nearby smoke red
    headLit: 1.6, // how strongly the headlight beams light the smoke and spray
    sprayRate: 26, // wet-road spray per rear wheel at speed (scaled by rain.intensity)
    spraySize: 0.28,
    sprayOpacity: 0.55,
    fullScreenFrom: 0.4, // drift progress where shot IV (the tyre) starts; before it smoke can't fill the frame
    maxCover: 0.28, // before shot IV: the most of the frame height a single puff may cover
    fillStart: 0.66, // smoke starts swelling toward the camera
    fillFull: 0.82, // screen is covered
    fillRate: 140, // extra particles/s spawned into the cloud at full fill
    fillGrow: 1.8,
    fillPull: 2.6,
    veilOpacity: 0.93,
    veilColor: '#5c626c',
  },

  skid: {
    opacity: 0.55,
    width: 0.3,
    minSlip: 0.15,
  },

  /** Rainy Mumbai seafront: sea wall on the road's left, city on the right. */
  coast: {
    seaWallOffset: 11.5, // (mount) metres from the centre line to the sea wall (sea side = left)
    seaLevel: -1.4, // (mount)
    sodium: '#ffa24d', // street lamp colour
    sodiumEmissive: 7,
    windowGlow: 0.7, // lit windows in the city
    neonGlow: 5, // neon signs
    shoreLights: 3.5, // the far shoreline "necklace" across the bay
    bridgeLights: 4,
    haze: 0.0026, // distance haze on the far city and bridge (they skip the normal fog)
    waveSpeed: 0.015,
  },

  /** Rain: streaks around the camera, splashes around the car, haze in the headlight beams. */
  rain: {
    count: 9000, // (mount) streaks in the box around the camera
    splashCount: 700, // (mount)
    mobileScale: 0.3, // (mount) phones get this fraction of streaks and splashes
    intensity: 1, // 0 = dry
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

  /** Chapters VI-XI (src/scene/districts). */
  districts: {
    transitionFog: 0.013, // fog density halfway through a move between districts (morning mist)
    transitionFogColor: '#5f5c5a',
    sparks: 140, // spark particles per click in the arena (halved on mobile)
    robotSpin: 22, // rad/s on the robot's spinner
    globeSpin: 0.08, // rad/s, the Hall of Voices globe
    hologram: 1, // hologram brightness in the expo
    heartbeatBpm: 56,
    heartbeatLight: 1, // how much the warm light swells on each beat
  },

  /** Post chain (src/scene/Effects.tsx). Mobile skips DOF, motion blur, streaks and lens drops. */
  post: {
    focusOnCar: true, // during the drift, keep the car in focus even when the shot looks past it
    motionBlur: 0.45, // share of each frame's motion that gets smeared (0.5 ~ 180 degree shutter)
    motionBlurMax: 0.025, // longest smear, in screen heights
    motionBlurSamples: 8, // (mount)
    cutDistance: 2.5, // metres the camera jumps in one frame that count as a cut (no blur that frame)
    anamorphic: 0.5, // horizontal lens streaks on the brightest lights
    anamorphicThreshold: 2.2, // HDR level where the streaks start
    anamorphicLength: 1,
    anamorphicTint: '#7fb0ff',
    grade: 1, // teal/orange LUT strength
    grain: 0.35, // film grain, strongest in the midtones
    lensDrops: 0.75, // rain drops on the lens (scaled by rain.intensity)
    lensDropRefract: 0.035,
    lensDropStreak: 0.09, // how far camera motion stretches the drops
    dissolve: 0.9, // seconds a chapter cross-dissolve takes
  },

  look: {
    background: '#04050a',
    bloomIntensity: 1.1,
    bloomThreshold: 0.9,
    bloomSmoothing: 0.25,
    chromaticOffset: 0.0009,
    chromaticShake: 0.0025, // extra aberration at shake peak
    vignetteOffset: 0.28,
    vignetteDarkness: 0.78,
    reflection: 25, // MeshReflectorMaterial mixStrength: how wet the asphalt looks
    reflectionBlur: 1, // mixBlur: how much rough patches smear the reflection
    lampEmissive: 6,
  },
};

export type Config = typeof CONFIG;

type Range = readonly [min: number, max: number, step?: number];

/** Slider ranges for the leva panel. Anything missing gets a plain number field. */
export const RANGES: { [G in keyof Config]?: { [K in keyof Config[G]]?: Range } } = {
  scroll: { progressSmooth: [0, 1, 0.01] },
  track: {
    arcARadius: [10, 80, 1],
    arcADeg: [-150, 150, 1],
    startInto: [0, 40, 0.5],
    straightMid: [10, 150, 1],
    arcBRadius: [10, 80, 1],
    arcBDeg: [-150, 150, 1],
    straightOut: [10, 150, 1],
    halfWidth: [4, 14, 0.1],
  },
  introDrift: {
    start: [-0.2, 0.5, 0.005],
    peakAt: [-0.2, 0.5, 0.005],
    holdUntil: [-0.2, 0.5, 0.005],
    end: [0, 0.5, 0.005],
    yawPeakDeg: [0, 60, 0.5],
  },
  drift: {
    start: [0, 1, 0.005],
    peakAt: [0, 1, 0.005],
    holdUntil: [0, 1, 0.005],
    end: [0, 1, 0.005],
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
    brakeAt: [0, 1, 0.005],
    brakeWidth: [0.005, 0.2, 0.005],
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
    anchorP: [0.4, 0.8, 0.01],
    shakePeak: [0, 0.3, 0.005],
    shakeAt: [0, 1, 0.005],
    shakeWidth: [0.01, 0.3, 0.005],
    shakeRollDeg: [0, 4, 0.05],
    shakeSpeed: [0, 3, 0.05],
    handheld: [0, 0.1, 0.001],
    dofScale: [0, 3, 0.05],
    portraitFit: [0, 1.5, 0.01],
    sectionSmooth: [0.05, 2, 0.01],
    parallax: [0, 1, 0.01],
  },
  smoke: {
    rate: [0, 150, 1],
    lifeMin: [0.5, 6, 0.1],
    lifeMax: [0.5, 8, 0.1],
    sizeStart: [0.1, 4, 0.05],
    sizeEnd: [0.5, 12, 0.1],
    opacity: [0, 1, 0.01],
    rise: [-1, 2, 0.01],
    drag: [0, 5, 0.05],
    noise: [0, 5, 0.05],
    kick: [0, 8, 0.1],
    tailTint: [0, 2, 0.05],
    headLit: [0, 8, 0.05],
    sprayRate: [0, 120, 1],
    spraySize: [0.05, 1.5, 0.01],
    sprayOpacity: [0, 1.5, 0.01],
    fullScreenFrom: [0, 1, 0.005],
    maxCover: [0.02, 2, 0.01],
    fillStart: [0, 1, 0.005],
    fillFull: [0, 1, 0.005],
    fillRate: [0, 400, 1],
    fillGrow: [0, 5, 0.05],
    fillPull: [0, 10, 0.1],
    veilOpacity: [0, 1, 0.01],
  },
  skid: { opacity: [0, 1, 0.01], width: [0.05, 0.8, 0.01], minSlip: [0, 1, 0.01] },
  coast: {
    sodiumEmissive: [0, 20, 0.1],
    windowGlow: [0, 6, 0.05],
    neonGlow: [0, 15, 0.1],
    shoreLights: [0, 12, 0.1],
    bridgeLights: [0, 12, 0.1],
    haze: [0, 0.01, 0.0001],
    waveSpeed: [0, 0.1, 0.001],
  },
  rain: {
    intensity: [0, 2, 0.01],
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
  districts: {
    transitionFog: [0, 0.06, 0.001],
    sparks: [0, 400, 1],
    robotSpin: [0, 60, 0.5],
    globeSpin: [0, 1, 0.01],
    hologram: [0, 3, 0.01],
    heartbeatBpm: [30, 120, 1],
    heartbeatLight: [0, 3, 0.01],
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
    dissolve: [0, 3, 0.05],
    motionBlur: [0, 1.5, 0.01],
    motionBlurMax: [0, 0.1, 0.001],
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
