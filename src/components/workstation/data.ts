/* ------------------------------------------------------------------ */
/*  Boali Radiology AI Workstation — mock data & types                 */
/* ------------------------------------------------------------------ */

export type Plane = "Axial" | "Coronal" | "Sagittal" | "3D";
export type PlaneFilter = "All" | Plane;

export interface Patient {
  id: string;
  name: string;
  sex: "M" | "F";
  age: number;
  studyShort: string;
  studyFull: string;
  date: string;
  time: string;
  thumb: string;
  starred: boolean;
  scanner: string;
  kv: string;
  mas: string;
  thickness: string;
}

export interface SeriesItem {
  id: string;
  plane: Plane;
  number: string;
  label: string;
  resolution: string;
  image: string;
  w: string;
  l: string;
  renderer: string;
}

export interface MetricCard {
  label: string;
  value: string;
  unit?: string;
  note: string;
  note2?: string;
  tone: "teal" | "green" | "red" | "plain";
  spark?: boolean;
  valuePrefixDot?: "green" | "red";
}

export interface ModuleResult {
  analysisName: string;
  confidenceBadge: string;
  findingThumb: string;
  findingTitle: string;
  findingLocation: string;
  findingConfidence: string;
  metrics: MetricCard[];
}

export interface AiModule {
  id: string;
  name: string;
  desc: string;
  icon: "lungs" | "bone" | "droplets" | "cube" | "stethoscope";
  iconClass: string;
  result: ModuleResult;
}

/* ------------------------------- patients ------------------------------- */

export const patients: Patient[] = [
  {
    id: "10039217",
    name: "Chen, Wei",
    sex: "M",
    age: 28,
    studyShort: "CT · Trauma",
    studyFull: "CT · Chest (Trauma)",
    date: "Apr 22, 2026",
    time: "09:14:27",
    thumb: "/workstation/thumb-skeleton.png",
    starred: true,
    scanner: "SOMATOM Force",
    kv: "120 kV",
    mas: "198 mAs",
    thickness: "0.6 mm",
  },
  {
    id: "10039102",
    name: "Rodriguez, Elena",
    sex: "F",
    age: 41,
    studyShort: "MR · Brain",
    studyFull: "MR · Brain (T1 + T2)",
    date: "Apr 21, 2026",
    time: "16:02:11",
    thumb: "/workstation/thumb-brain-mri.png",
    starred: false,
    scanner: "MAGNETOM Vida 3T",
    kv: "—",
    mas: "—",
    thickness: "1.0 mm",
  },
  {
    id: "10039011",
    name: "Kim, Jisoo",
    sex: "F",
    age: 55,
    studyShort: "CT · Chest",
    studyFull: "CT · Chest (Routine)",
    date: "Apr 21, 2026",
    time: "11:38:44",
    thumb: "/workstation/thumb-chest-ct.png",
    starred: true,
    scanner: "SOMATOM Force",
    kv: "120 kV",
    mas: "174 mAs",
    thickness: "1.0 mm",
  },
  {
    id: "10038976",
    name: "Patel, Arjun",
    sex: "M",
    age: 63,
    studyShort: "CT · Abdomen",
    studyFull: "CT · Abdomen (Portal Phase)",
    date: "Apr 20, 2026",
    time: "14:22:05",
    thumb: "/workstation/thumb-pelvis-xray.png",
    starred: false,
    scanner: "SOMATOM Definition AS+",
    kv: "120 kV",
    mas: "210 mAs",
    thickness: "2.0 mm",
  },
  {
    id: "10038844",
    name: "Williams, Sophia",
    sex: "F",
    age: 47,
    studyShort: "MG · Breast",
    studyFull: "MG · Breast (Bilateral)",
    date: "Apr 20, 2026",
    time: "10:05:53",
    thumb: "/workstation/thumb-mammogram.png",
    starred: false,
    scanner: "MAMMOMAT Revelation",
    kv: "28 kV",
    mas: "62 mAs",
    thickness: "—",
  },
];

/* extra patients revealed by “Load More” */
export const morePatients: Patient[] = [
  {
    id: "10038712",
    name: "Okafor, Amara",
    sex: "F",
    age: 34,
    studyShort: "CT · Chest",
    studyFull: "CT · Chest (Routine)",
    date: "Apr 19, 2026",
    time: "13:47:19",
    thumb: "/workstation/thumb-chest-ct.png",
    starred: false,
    scanner: "SOMATOM Force",
    kv: "120 kV",
    mas: "168 mAs",
    thickness: "1.0 mm",
  },
  {
    id: "10038650",
    name: "Nakamura, Ken",
    sex: "M",
    age: 61,
    studyShort: "CT · Trauma",
    studyFull: "CT · Whole Body (Trauma)",
    date: "Apr 19, 2026",
    time: "09:26:03",
    thumb: "/workstation/fs-vr.png",
    starred: false,
    scanner: "SOMATOM Force",
    kv: "120 kV",
    mas: "192 mAs",
    thickness: "0.6 mm",
  },
  {
    id: "10038591",
    name: "Garcia, Maria",
    sex: "F",
    age: 52,
    studyShort: "MG · Breast",
    studyFull: "MG · Breast (Screening)",
    date: "Apr 18, 2026",
    time: "15:12:40",
    thumb: "/workstation/thumb-mammogram.png",
    starred: false,
    scanner: "MAMMOMAT Revelation",
    kv: "27 kV",
    mas: "58 mAs",
    thickness: "—",
  },
];

/* ------------------------------- series ---------------------------------- */

export const seriesByPatient: Record<string, SeriesItem[]> = {
  "10039217": [
    {
      id: "s1",
      plane: "Axial",
      number: "1",
      label: "Lung",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-lung.png",
      w: "1500",
      l: "-300",
      renderer: "Axial",
    },
    {
      id: "s2",
      plane: "Axial",
      number: "56",
      label: "Mediastinum",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-mediastinum.png",
      w: "350",
      l: "40",
      renderer: "Axial",
    },
    {
      id: "s3",
      plane: "Coronal",
      number: "112",
      label: "Coronal",
      resolution: "512 × 512",
      image: "/workstation/fs-coronal.png",
      w: "1500",
      l: "-300",
      renderer: "Coronal",
    },
    {
      id: "s4",
      plane: "Sagittal",
      number: "168",
      label: "Sagittal",
      resolution: "512 × 512",
      image: "/workstation/fs-sagittal.png",
      w: "1500",
      l: "-300",
      renderer: "Sagittal",
    },
    {
      id: "s5",
      plane: "3D",
      number: "3D",
      label: "VR",
      resolution: "1024 × 1024",
      image: "/workstation/vr-ribcage.png",
      w: "1500",
      l: "300",
      renderer: "3D VR",
    },
  ],
  "10039102": [
    {
      id: "r1",
      plane: "Axial",
      number: "12",
      label: "T1 Axial",
      resolution: "512 × 512",
      image: "/workstation/thumb-brain-mri.png",
      w: "240",
      l: "120",
      renderer: "Axial",
    },
    {
      id: "r2",
      plane: "Coronal",
      number: "48",
      label: "T1 Coronal",
      resolution: "512 × 512",
      image: "/workstation/fs-coronal.png",
      w: "240",
      l: "120",
      renderer: "Coronal",
    },
    {
      id: "r3",
      plane: "Sagittal",
      number: "72",
      label: "T1 Sagittal",
      resolution: "512 × 512",
      image: "/workstation/fs-sagittal.png",
      w: "240",
      l: "120",
      renderer: "Sagittal",
    },
  ],
  "10039011": [
    {
      id: "k1",
      plane: "Axial",
      number: "24",
      label: "Lung",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-lung.png",
      w: "1500",
      l: "-300",
      renderer: "Axial",
    },
    {
      id: "k2",
      plane: "Axial",
      number: "61",
      label: "Mediastinum",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-mediastinum.png",
      w: "350",
      l: "40",
      renderer: "Axial",
    },
    {
      id: "k3",
      plane: "Coronal",
      number: "90",
      label: "Coronal",
      resolution: "512 × 512",
      image: "/workstation/fs-coronal.png",
      w: "1500",
      l: "-300",
      renderer: "Coronal",
    },
  ],
  "10038976": [
    {
      id: "p1",
      plane: "Axial",
      number: "33",
      label: "Portal",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-mediastinum.png",
      w: "350",
      l: "50",
      renderer: "Axial",
    },
    {
      id: "p2",
      plane: "Coronal",
      number: "77",
      label: "Coronal",
      resolution: "512 × 512",
      image: "/workstation/fs-coronal.png",
      w: "400",
      l: "40",
      renderer: "Coronal",
    },
    {
      id: "p3",
      plane: "Sagittal",
      number: "101",
      label: "Sagittal",
      resolution: "512 × 512",
      image: "/workstation/fs-sagittal.png",
      w: "400",
      l: "40",
      renderer: "Sagittal",
    },
  ],
  "10038844": [
    {
      id: "m1",
      plane: "Axial",
      number: "CC L",
      label: "CC Left",
      resolution: "2048 × 2048",
      image: "/workstation/thumb-mammogram.png",
      w: "4095",
      l: "2048",
      renderer: "MG",
    },
    {
      id: "m2",
      plane: "Axial",
      number: "MLO R",
      label: "MLO Right",
      resolution: "2048 × 2048",
      image: "/workstation/thumb-mammogram.png",
      w: "4095",
      l: "2048",
      renderer: "MG",
    },
  ],
  "10038712": [
    {
      id: "o1",
      plane: "Axial",
      number: "18",
      label: "Lung",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-lung.png",
      w: "1500",
      l: "-300",
      renderer: "Axial",
    },
    {
      id: "o2",
      plane: "Coronal",
      number: "44",
      label: "Coronal",
      resolution: "512 × 512",
      image: "/workstation/fs-coronal.png",
      w: "1500",
      l: "-300",
      renderer: "Coronal",
    },
  ],
  "10038650": [
    {
      id: "n1",
      plane: "3D",
      number: "3D",
      label: "VR",
      resolution: "1024 × 1024",
      image: "/workstation/fs-vr.png",
      w: "1500",
      l: "300",
      renderer: "3D VR",
    },
    {
      id: "n2",
      plane: "Axial",
      number: "5",
      label: "Lung",
      resolution: "512 × 512",
      image: "/workstation/fs-axial-lung.png",
      w: "1500",
      l: "-300",
      renderer: "Axial",
    },
    {
      id: "n3",
      plane: "Sagittal",
      number: "132",
      label: "Sagittal",
      resolution: "512 × 512",
      image: "/workstation/fs-sagittal.png",
      w: "1500",
      l: "-300",
      renderer: "Sagittal",
    },
  ],
  "10038591": [
    {
      id: "g1",
      plane: "Axial",
      number: "CC L",
      label: "CC Left",
      resolution: "2048 × 2048",
      image: "/workstation/thumb-mammogram.png",
      w: "4095",
      l: "2048",
      renderer: "MG",
    },
  ],
};

/* default: patient 1, 3D VR render (as in the reference design) */
export const DEFAULT_PATIENT_ID = "10039217";
export const DEFAULT_SERIES_ID = "s5";

/* ------------------------------- filmstrip chips ------------------------- */

export const seriesChips: { label: PlaneFilter; count: number }[] = [
  { label: "All", count: 276 },
  { label: "Axial", count: 168 },
  { label: "Coronal", count: 54 },
  { label: "Sagittal", count: 54 },
  { label: "3D", count: 4 },
];

/* ------------------------------- AI modules ------------------------------ */

export const aiModules: AiModule[] = [
  {
    id: "bone",
    name: "Bone Suppression",
    desc: "AI-powered soft tissue reconstruction",
    icon: "lungs",
    iconClass:
      "bg-gradient-to-br from-[#0e7490] to-[#38bdf8] text-white shadow-[0_2px_10px_rgba(56,189,248,0.25)]",
    result: {
      analysisName: "Soft Tissue Analysis",
      confidenceBadge: "High Confidence",
      findingThumb: "/workstation/fs-axial-lung.png",
      findingTitle: "Bone suppressed",
      findingLocation: "Chest radiograph, bilateral ribs",
      findingConfidence: "94%",
      metrics: [
        {
          label: "Suppression",
          value: "94%",
          note: "of rib cage removed",
          tone: "teal",
          spark: true,
        },
        {
          label: "Soft Tissue CNR",
          value: "12.8",
          unit: ":1",
          note: "contrast-to-noise ratio",
          tone: "green",
        },
        {
          label: "Noise (σ)",
          value: "18",
          note: "HU at lung base",
          tone: "plain",
        },
        {
          label: "Coverage",
          value: "Full",
          note: "both lungs included",
          note2: "2048 × 2048",
          tone: "plain",
        },
      ],
    },
  },
  {
    id: "fracture",
    name: "Fracture",
    desc: "Detect and classify fractures with AI",
    icon: "bone",
    iconClass: "bg-[#2a3950] text-[#e2e8f0]",
    result: {
      analysisName: "Fracture Detection",
      confidenceBadge: "High Confidence",
      findingThumb: "/workstation/finding-ct.png",
      findingTitle: "Fracture detected",
      findingLocation: "Left 5th rib, lateral aspect",
      findingConfidence: "96%",
      metrics: [
        {
          label: "BMD (L1–L4)",
          value: "1.24",
          unit: "g/cm²",
          note: "Normal range 0.90 – 1.40",
          tone: "teal",
          spark: true,
        },
        {
          label: "Fracture Risk (AI)",
          value: "Low",
          note: "3% · 10-year risk",
          tone: "green",
          valuePrefixDot: "green",
        },
        {
          label: "Rib Fractures",
          value: "1",
          note: "detected",
          note2: "Left 5th rib",
          tone: "red",
          valuePrefixDot: "red",
        },
        {
          label: "Volume Render",
          value: "High",
          note: "quality",
          note2: "1024 × 1024",
          tone: "plain",
        },
      ],
    },
  },
  {
    id: "mammo",
    name: "Mammography",
    desc: "AI assistant for breast imaging",
    icon: "droplets",
    iconClass: "bg-[#1c3f68] text-[#60a5fa]",
    result: {
      analysisName: "Breast Imaging AI",
      confidenceBadge: "Moderate Confidence",
      findingThumb: "/workstation/thumb-mammogram.png",
      findingTitle: "No mass detected",
      findingLocation: "Bilateral screening study",
      findingConfidence: "91%",
      metrics: [
        {
          label: "Breast Density",
          value: "B",
          note: "scattered fibroglandular",
          tone: "teal",
        },
        {
          label: "BI-RADS (AI)",
          value: "1",
          note: "negative screening",
          tone: "green",
          valuePrefixDot: "green",
        },
        {
          label: "Calcifications",
          value: "0",
          note: "clustered — none found",
          tone: "green",
        },
        {
          label: "Symmetry",
          value: "Normal",
          note: "left vs right comparison",
          note2: "2048 × 2048",
          tone: "plain",
        },
      ],
    },
  },
  {
    id: "chest18",
    name: "Lung Screen",
    desc: "18 chest pathologies multi-label AI",
    icon: "stethoscope",
    iconClass: "bg-[#123a4d] text-[#7dd3fc]",
    result: {
      analysisName: "Chest Pathology Screening",
      confidenceBadge: "Moderate Confidence",
      findingThumb: "/workstation/fs-axial-lung.png",
      findingTitle: "Screening complete",
      findingLocation: "Frontal chest radiograph",
      findingConfidence: "88%",
      metrics: [
        {
          label: "Pathologies",
          value: "18",
          note: "multi-label output layer",
          tone: "teal",
          spark: true,
        },
        {
          label: "Atelectasis",
          value: "0.12",
          note: "below positive threshold",
          tone: "green",
        },
        {
          label: "Cardiomegaly",
          value: "0.09",
          note: "below positive threshold",
          tone: "green",
        },
        {
          label: "Input",
          value: "224²",
          note: "center-crop normalization",
          note2: "[-1024, 1024] rescale",
          tone: "plain",
        },
      ],
    },
  },
  {
    id: "studio",
    name: "3D Studio",
    desc: "Advanced 3D visualization and modeling",
    icon: "cube",
    iconClass: "bg-[#20325c] text-[#7c9ff5]",
    result: {
      analysisName: "3D Reconstruction",
      confidenceBadge: "High Confidence",
      findingThumb: "/workstation/fs-vr.png",
      findingTitle: "Volume rendered",
      findingLocation: "Thorax, bone preset",
      findingConfidence: "99%",
      metrics: [
        {
          label: "Render Quality",
          value: "High",
          note: "ray-cast GPU pipeline",
          tone: "teal",
          spark: true,
        },
        {
          label: "Gantry Tilt",
          value: "0°",
          note: "corrected automatically",
          tone: "green",
        },
        {
          label: "Slices Merged",
          value: "276",
          note: "contiguous reconstruction",
          tone: "plain",
        },
        {
          label: "Export",
          value: "Ready",
          note: "STL · OBJ · MP4",
          note2: "1024 × 1024",
          tone: "plain",
        },
      ],
    },
  },
];

export const DEFAULT_MODULE_ID = "fracture";

/* ------------------------------- tools tab ------------------------------- */

export const toolItems = [
  { icon: "sliders", name: "Window / Level", value: "W 1500 · L -300" },
  { icon: "ruler", name: "Measure", value: "Hounsfield units" },
  { icon: "move3d", name: "MPR Planes", value: "Ax · Cor · Sag" },
  { icon: "contrast", name: "Contrast Agent", value: "Iohexol 350" },
  { icon: "grid", name: "Reference Grids", value: "3 × 4 layout" },
  { icon: "play", name: "CINE Loop", value: "12 fps" },
] as const;

/* ------------------------------- report tab ------------------------------ */

export const reportSections = [
  {
    title: "Clinical History",
    lines: ["28-year-old male, blunt chest trauma following a fall from height."],
  },
  {
    title: "Technique",
    lines: ["CT chest with IV contrast, 0.6 mm slices, 3D volume reconstruction."],
  },
  {
    title: "Findings",
    lines: [
      "Single non-displaced fracture of the left 5th rib, lateral aspect.",
      "No pneumothorax or hemothorax. Lung parenchyma unremarkable.",
      "BMD (L1–L4) 1.24 g/cm² — within normal limits.",
    ],
  },
  {
    title: "Impression",
    lines: [
      "Isolated left 5th rib fracture. 10-year fracture risk: low (3%).",
      "No indication for surgical intervention.",
    ],
  },
];
