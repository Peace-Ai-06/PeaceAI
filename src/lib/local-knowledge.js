// A compact, offline knowledge base for PeaceAi Local. It gives the built-in
// assistant real, direct answers to common school/general questions instead of
// echoing the question back. This is curated reference text, not a neural model.

const ENTRIES = [
  {
    title: 'Biology',
    patterns: [/\bbiolog(y|ical|ically)\b/i],
    answer: 'Biology is the science of life and living organisms. It looks at how living things are built, how they work, how they reproduce, how they interact with each other and their environment, and how life has changed over time.',
    points: [
      'Cells are the basic structural and functional unit of all living things.',
      'DNA carries the instructions that make proteins and determine traits.',
      'Energy flows through ecosystems, starting with producers such as plants.',
      'Evolution explains how the variety of life arose over generations.',
    ],
  },
  {
    title: 'The cell',
    patterns: [/\bcells?\b/i, /\bcell structure\b/i],
    answer: 'A cell is the smallest unit that is considered alive. Every organism is made of one or more cells. Animal cells have a membrane, cytoplasm and a nucleus. Plant cells also have a rigid cell wall and chloroplasts for photosynthesis.',
    points: [
      'The membrane controls what enters and leaves the cell.',
      'The nucleus stores DNA and directs the cell’s activities.',
      'Mitochondria release energy from food.',
      'Ribosomes build proteins.',
    ],
  },
  {
    title: 'Photosynthesis',
    patterns: [/\bphotosynthes(is|ize|izing)\b/i, /\bphoto[- ]?synthesis\b/i, /\bchlorophyll\b/i],
    answer: 'Photosynthesis is the process plants, algae and some bacteria use to make food from light. They take in carbon dioxide and water and, using chlorophyll to capture sunlight, produce glucose and oxygen.',
    equation: '6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂',
    points: [
      'It happens mainly in the chloroplasts of leaf cells.',
      'Glucose is used for energy or stored as starch.',
      'The oxygen released is what we breathe in.',
      'It is the foundation of most food chains.',
    ],
  },
  {
    title: 'Cellular respiration',
    patterns: [/\bcellular respiration\b/i, /\brespiration\b/i, /\bATP\b/i],
    answer: 'Cellular respiration is how cells release usable energy from glucose. In the presence of oxygen, glucose is broken down in the mitochondria to produce carbon dioxide, water and ATP, the energy currency of the cell.',
    equation: 'C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + ATP',
    points: [
      'It is the reverse of photosynthesis in overall chemistry.',
      'Most ATP is made in the mitochondria.',
      'Without oxygen, cells use fermentation and release much less energy.',
    ],
  },
  {
    title: 'Mitosis',
    patterns: [/\bmitosis\b/i, /\bmitotic\b/i],
    answer: 'Mitosis is the division of a cell’s nucleus that produces two daughter cells genetically identical to the parent. It is used for growth, repair and asexual reproduction.',
    points: [
      'Stages: prophase, metaphase, anaphase, telophase.',
      'Chromosomes are copied before mitosis begins.',
      'Each daughter cell receives the full set of chromosomes.',
    ],
  },
  {
    title: 'Meiosis',
    patterns: [/\bmeiosis\b/i, /\bmeiotic\b/i, /\bgametes?\b/i],
    answer: 'Meiosis is a special type of cell division that makes gametes — sperm and egg cells. It has two divisions and halves the chromosome number, so that fertilisation restores the normal number.',
    points: [
      'Humans end up with 23 chromosomes in each gamete.',
      'Crossing over during meiosis creates genetic variation.',
      'It is essential for sexual reproduction.',
    ],
  },
  {
    title: 'DNA',
    patterns: [/\bDNA\b/i, /\bdeoxyribonucleic\b/i, /\bdouble helix\b/i],
    answer: 'DNA (deoxyribonucleic acid) is the molecule that stores genetic instructions. It is shaped like a double helix, with paired bases: adenine with thymine, and cytosine with guanine.',
    points: [
      'Genes are sections of DNA that code for proteins.',
      'The base order is the genetic code.',
      'DNA is copied before a cell divides.',
    ],
  },
  {
    title: 'Genes and chromosomes',
    patterns: [/\bgenes?\b/i, /\bgenetic(s|ally)?\b/i, /\bchromosomes?\b/i, /\bheredity\b/i, /\balleles?\b/i],
    answer: 'A gene is a segment of DNA that carries instructions for a trait, usually by coding for a protein. Genes are carried on chromosomes. Humans have 46 chromosomes arranged in 23 pairs.',
    points: [
      'Different versions of a gene are called alleles.',
      'Dominant alleles can mask recessive ones.',
      'Mutations are changes in the DNA sequence.',
    ],
  },
  {
    title: 'Proteins and enzymes',
    patterns: [/\bproteins?\b/i, /\benzymes?\b/i, /\bamino acids?\b/i],
    answer: 'Proteins are chains of amino acids that fold into specific shapes. They build structures, transport molecules, fight infection and act as enzymes. Enzymes are biological catalysts that speed up reactions without being used up.',
    points: [
      'Each enzyme has an active site shaped for a particular substrate.',
      'Temperature and pH can change how well an enzyme works.',
      'Denaturation happens when a protein loses its shape.',
    ],
  },
  {
    title: 'Metabolism',
    patterns: [/\bmetabolis(m|ic)\b/i],
    answer: 'Metabolism is the sum of all chemical reactions in a living organism. It has two sides: anabolism builds complex molecules and needs energy, while catabolism breaks molecules down and releases energy.',
    points: [
      'Enzymes control metabolic pathways.',
      'Respiration is a catabolic process.',
      'Photosynthesis is an anabolic process.',
    ],
  },
  {
    title: 'Ecosystems and food chains',
    patterns: [/\becosystems?\b/i, /\becolog(y|ical)\b/i, /\bfood chain\b/i, /\bfood web\b/i, /\bhabitats?\b/i],
    answer: 'An ecosystem is a community of living organisms together with the non-living environment they interact with. Energy enters through producers and passes along food chains to consumers and decomposers.',
    points: [
      'Producers, such as plants, make their own food.',
      'Consumers eat plants or other animals.',
      'Decomposers recycle nutrients back into the soil.',
      'A food web is several interconnected food chains.',
    ],
  },
  {
    title: 'Evolution and natural selection',
    patterns: [/\bevolution\b/i, /\bevolve(d|s)?\b/i, /\bnatural selection\b/i, /\bdarwin\b/i],
    answer: 'Evolution is the change in inherited characteristics of populations over successive generations. Natural selection is one mechanism: individuals with traits better suited to their environment tend to survive and reproduce more, so those traits become commoner.',
    points: [
      'Mutation creates new variation.',
      'Genetic drift and gene flow also change populations.',
      'Natural selection acts on individuals, but populations evolve.',
    ],
  },
  {
    title: 'Bacteria and viruses',
    patterns: [/\bbacteria\b/i, /\bbacterium\b/i, /\bvirus(es)?\b/i, /\bmicrobes?\b/i, /\bmicroorganisms?\b/i],
    answer: 'Bacteria are single-celled organisms without a nucleus; they reproduce by splitting and many are harmless or helpful. Viruses are much smaller infectious particles that can only reproduce inside a host cell, so they are not usually classed as living.',
    points: [
      'Bacteria have a cell wall and their own metabolism.',
      'Viruses contain DNA or RNA inside a protein coat.',
      'Antibiotics work on bacteria, not viruses.',
    ],
  },
  {
    title: 'The heart and blood',
    patterns: [/\bheart\b/i, /\bblood\b/i, /\bcirculator(y|ion)\b/i, /\bhaemoglobin\b/i, /\bhemoglobin\b/i],
    answer: 'The heart is a muscular pump with four chambers that keeps blood moving around the body. Blood carries oxygen, nutrients, hormones and waste products.',
    points: [
      'Red blood cells carry oxygen using haemoglobin.',
      'White blood cells help fight infection.',
      'Platelets help blood clot.',
      'Plasma is the liquid part of blood.',
    ],
  },
  {
    title: 'The nervous system',
    patterns: [/\bneurons?\b/i, /\bnerves?\b/i, /\bnervous system\b/i, /\bbrain\b/i, /\bsynapses?\b/i],
    answer: 'The nervous system uses neurons to carry electrical signals around the body. A neuron has dendrites to receive signals, a cell body, an axon to send signals, and synapses where it passes messages to the next cell.',
    points: [
      'The brain and spinal cord make up the central nervous system.',
      'Sensory neurons carry information from sense organs.',
      'Motor neurons carry instructions to muscles.',
    ],
  },
  {
    title: 'Plants',
    patterns: [/\bplants?\b/i, /\bleaves\b/i, /\broots?\b/i, /\bflowers?\b/i],
    answer: 'Plants are mostly photosynthetic organisms. Roots anchor them and absorb water and minerals, stems support them and transport materials, and leaves carry out photosynthesis.',
    points: [
      'Chloroplasts in leaves contain chlorophyll.',
      'Xylem carries water upward; phloem carries sugar.',
      'Flowers are the reproductive structures of flowering plants.',
    ],
  },
  {
    title: 'Microscopes',
    patterns: [/\bmicroscopes?\b/i, /\bmagnification\b/i],
    answer: 'A microscope magnifies objects too small to see with the naked eye. Light microscopes use lenses and light and can show cells; electron microscopes use electrons and can show much finer detail such as organelles.',
    points: [
      'Magnification makes an image bigger.',
      'Resolution is the ability to distinguish two close points.',
      'Stains can make transparent structures easier to see.',
    ],
  },
  {
    title: 'Anatomy and physiology',
    patterns: [/\banatomy\b/i, /\bphysiolog(y|ical)\b/i, /\borgan(s)?\b/i],
    answer: 'Anatomy is the study of the structure of the body; physiology is the study of how those structures work. Together they explain how organs such as the heart, lungs, liver and brain keep the body functioning.',
    points: [
      'Organs work together in organ systems.',
      'Structure and function are closely linked in biology.',
    ],
  },
  {
    title: 'Gravity',
    patterns: [/\bgravity\b/i, /\bgravitation(al)?\b/i],
    answer: 'Gravity is the force of attraction between objects with mass. On Earth it gives things weight and pulls them toward the ground. The same force keeps the planets in orbit around the Sun.',
    points: [
      'The strength of gravity depends on mass and distance.',
      'Weight is mass times gravitational acceleration (about 9.8 m/s² on Earth).',
    ],
  },
  {
    title: 'Atoms and elements',
    patterns: [/\batoms?\b/i, /\belements?\b/i, /\bmolecules?\b/i, /\bperiodic table\b/i],
    answer: 'An atom is the smallest unit of an element that still has that element’s properties. Atoms consist of a nucleus of protons and neutrons, surrounded by electrons. Molecules are two or more atoms bonded together.',
    points: [
      'The number of protons defines the element.',
      'Electrons occupy shells around the nucleus.',
      'Chemical reactions involve electrons, not the nucleus.',
    ],
  },
  {
    title: 'The water cycle',
    patterns: [/\bwater cycle\b/i, /\bevaporation\b/i, /\bcondensation\b/i, /\bprecipitation\b/i],
    answer: 'The water cycle describes how water moves around the Earth. The Sun heats water so it evaporates, the vapour cools and condenses into clouds, and water falls as precipitation before collecting in rivers, lakes and oceans.',
    points: [
      'Evaporation: liquid water becomes vapour.',
      'Condensation: vapour becomes tiny droplets.',
      'Precipitation: rain, snow or hail falls.',
      'Collection: water gathers and the cycle repeats.',
    ],
  },
  {
    title: 'The solar system',
    patterns: [/\bsolar system\b/i, /\bplanets?\b/i, /\bthe sun\b/i],
    answer: 'The solar system is the Sun and everything that orbits it, including eight planets, their moons, asteroids and comets. The planets are held in orbit by the Sun’s gravity.',
    points: [
      'The inner planets are rocky: Mercury, Venus, Earth and Mars.',
      'The outer planets are gas and ice giants.',
      'Earth is the only known planet with life.',
    ],
  },
  {
    title: 'Computers and the internet',
    patterns: [/\bcomputers?\b/i, /\binternet\b/i, /\bsoftware\b/i, /\bhardware\b/i],
    answer: 'A computer is a machine that takes input, processes data according to instructions, stores results and produces output. The internet is a global network that connects computers so they can share information.',
    points: [
      'Hardware is the physical parts; software is the instructions.',
      'The CPU carries out the processing.',
      'Websites are served over the internet using protocols such as HTTP.',
    ],
  },
  {
    title: 'Artificial intelligence',
    patterns: [/\bartificial intelligence\b/i, /\bAI\b/, /\bmachine learning\b/i, /\bneural network\b/i],
    answer: 'Artificial intelligence is the field of making computer systems perform tasks that normally need human intelligence, such as understanding language, recognising images and making decisions. Machine learning is a branch of AI where systems improve from data rather than being explicitly programmed for every rule.',
    points: [
      'Large language models generate text by predicting likely next words.',
      'AI systems can make mistakes, so important answers should be checked.',
      'PeaceAi Local is a deterministic offline assistant, not a neural model.',
    ],
  },
];

/** Return the first matching curated topic for a question, if any. */
export function findKnowledge(raw) {
  const text = String(raw || '');
  return ENTRIES.find((entry) => entry.patterns.some((pattern) => pattern.test(text))) || null;
}

/** Format a curated topic as a readable chat answer. */
export function formatKnowledge(entry) {
  const lines = [`**${entry.title}**`, '', entry.answer];
  if (entry.equation) lines.push('', `> ${entry.equation}`);
  if (entry.points?.length) {
    lines.push('', entry.points.map((point) => `- ${point}`).join('\n'));
  }
  lines.push('', 'Want me to go deeper on any part of this, or explain it in a different way?');
  return lines.join('\n');
}
