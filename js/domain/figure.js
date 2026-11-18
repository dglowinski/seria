// The figure at rest: where its joints are when it stands in the pose it was
// modelled in. The moves in three dimensions (moves3d.js) are worked out
// against these measures, so that hands and feet land where the bones of the
// model put them.
//
// Written by scripts/build-figure.mjs from the model in assets/figure.bin
// (Sports_Male_04, Microsoft Rocketbox avatar library, MIT license). Do not edit by hand.
//
// Units are those of the drawings: one is a little over 2 cm, the hip joint
// stands 40 above the floor. x points forward, y up, z to the figure's right.
// R is the right side, L the left.

export const FIGURE = {
  name: 'Sports_Male_04',
  unit: 0.02238, // metres to one unit
  joints: {
    hipC: [0, 40, 0], s0: [-0.073, 45.374, 0], s1: [-0.383, 52.211, 0], s2: [-0.88, 59.037, 0], neck: [-0.544, 67.957, 0], head: [0.364, 70.915, 0], headC: [1.129, 75.168, -0.01],
    hipR: [0, 40, 3.949], kneeR: [0.728, 22.21, 4.892], ankleR: [-0.649, 4.541, 5.227], toeR: [5.329, 0.109, 6.753], tipR: [8.869, 0.109, 6.753], shR: [-1.134, 63.813, 9.4], elbowR: [-0.859, 54.955, 18.595], wristR: [3.614, 46.72, 26.258], gripR: [4.63, 44.106, 27.608],
    hipL: [0, 40, -3.949], kneeL: [0.728, 22.21, -4.892], ankleL: [-0.649, 4.541, -5.227], toeL: [5.329, 0.109, -6.753], tipL: [8.869, 0.109, -6.753], shL: [-1.134, 63.813, -9.4], elbowL: [-0.859, 54.955, -18.595], wristL: [3.614, 46.72, -26.258], gripL: [4.63, 44.106, -27.608],
  },
  // Which way the palm faces at rest, and the line across it from the first finger to the little one.
  palmR: [0.059, -0.586, -0.808], palmL: [0.059, -0.586, 0.808],
  acrossR: [-0.991, -0.131, 0.022], acrossL: [-0.991, -0.131, -0.022],
  headR: 5.57,
  top: 80.738,
  // The bones of the model that each part of the figure turns.
  bones: {"root":"Bip01_Pelvis","pelvis":"Bip01_Pelvis","s0":"Bip01_Spine","s1":"Bip01_Spine1","s2":"Bip01_Spine2","neck":"Bip01_Neck","head":"Bip01_Head","upperR":"Bip01_R_UpperArm","foreR":"Bip01_R_Forearm","handR":"Bip01_R_Hand","thighR":"Bip01_R_Thigh","shinR":"Bip01_R_Calf","footR":"Bip01_R_Foot","upperL":"Bip01_L_UpperArm","foreL":"Bip01_L_Forearm","handL":"Bip01_L_Hand","thighL":"Bip01_L_Thigh","shinL":"Bip01_L_Calf","footL":"Bip01_L_Foot"},
};
