// Exercises and practice sentences.

export const GOAL_PRESETS = [
  { id: 'deep', label: 'Deep feminine', low: 165, high: 200, note: 'A lower, warmer feminine range.' },
  { id: 'androgynous', label: 'Androgynous', low: 145, high: 175, note: 'The overlap that many voices of any gender share.' },
  { id: 'lighter', label: 'Lighter feminine', low: 190, high: 240, note: 'A higher, brighter placement.' },
];

// Each tone is a list of [seconds, semitones from the center of your zone].
export const TONES = {
  hold: {
    id: 'hold',
    title: 'Hold one note',
    howTo: 'Listen, then hum "mmm" or sing "oo" on the same note. Keep it easy and steady.',
    points: [[0, 0], [3.5, 0]],
  },
  steps: {
    id: 'steps',
    title: 'Three steps up',
    howTo: 'Move through three notes on "mee" or "moo", without pushing on the top one.',
    points: [[0, -2], [1.2, -2], [1.2, 0], [2.4, 0], [2.4, 2], [3.6, 2]],
  },
  glideUp: {
    id: 'glideUp',
    title: 'Glide up',
    howTo: 'Slide smoothly up on "ooh", like a curious "hmm?".',
    points: [[0, -3], [2.5, 3]],
  },
  glideDown: {
    id: 'glideDown',
    title: 'Glide down',
    howTo: 'Slide smoothly down on "ahh", like a relaxed sigh. Stop before your voice gets gravelly.',
    points: [[0, 3], [2.5, -3]],
  },
  wave: {
    id: 'wave',
    title: 'Up-and-over wave',
    howTo: 'Rise and fall in one breath on "ng" or a lip trill. This builds the movement that speech melody uses.',
    points: [[0, -3], [1.75, 3], [3.5, -3]],
  },
};

export const WARMUPS = [
  { title: 'Loosen up', body: 'Roll your shoulders, then yawn and sigh a couple of times.' },
  { title: 'Gentle hums', body: 'Hum quietly for three breaths at a comfortable pitch. Feel the buzz around your lips.' },
  { title: 'Lip trills or a straw', body: 'Do lip trills, or hum through a drinking straw, gliding gently up and down for about 30 seconds.' },
  { title: 'Sirens on "ng"', body: 'Slide softly from low to high and back, three times. Stop anywhere that feels tight.' },
];

export const PATTERNS = {
  voiced: { label: 'Smooth sounds', cue: 'Keep the sound flowing and stay in your zone.' },
  statement: { label: 'Statement', cue: 'Let it fall gently at the end, but stay in your zone.' },
  question: { label: 'Yes/no question', cue: 'Let your pitch rise at the end. ↗' },
  list: { label: 'List', cue: 'Lift each item, then let the last one settle.' },
  lively: { label: 'Expressive', cue: 'Use a lot of melody and really mean it.' },
};

export const SENTENCES = {
  en: {
    voiced: [
      'Many lovely lemons lie in the morning sun.',
      'My mom loves mellow music in the evening.',
      'We were all waiting on the old yellow lawn.',
      'Nine new lions are roaming around Rome.',
    ],
    statement: [
      'The bakery on the corner opens at seven.',
      "I'm meeting a friend for lunch tomorrow.",
      'We walked along the river until the sun went down.',
      'My sister moved to a small town near the mountains.',
      'The train was late again this morning.',
      'I made some tea and sat down by the window.',
    ],
    question: [
      'Do you want to come over later?',
      'Have you seen my blue umbrella?',
      'Is this seat taken?',
      'Could you open the window for me?',
      'Are we still meeting on Monday?',
      'Did you remember to call the doctor?',
    ],
    list: [
      'I bought apples, lemons, bread, and honey.',
      'We need milk, eggs, flour, and butter.',
      'She speaks German, English, Italian, and Spanish.',
      'On Monday, Wednesday, and Friday, I go swimming.',
    ],
    lively: [
      "Oh, that's wonderful news, I'm so happy for you!",
      "I can't believe how beautiful this garden is!",
      'What a lovely surprise to see you here!',
      "You won't believe what happened to me today!",
      'Wow, you really made all of this yourself!',
    ],
  },
  de: {
    voiced: [
      'Meine Mama malt mir morgens bunte Blumen.',
      'Im warmen Sommer wandern wir am Meer.',
      'Lena mag milden Honig und warme Milch.',
      'Wir wollen immer wieder nach Bremen fahren.',
    ],
    statement: [
      'Die Bäckerei an der Ecke öffnet um sieben.',
      'Ich treffe morgen eine Freundin zum Mittagessen.',
      'Wir sind am Fluss entlanggelaufen, bis die Sonne unterging.',
      'Meine Schwester ist in eine kleine Stadt in den Bergen gezogen.',
      'Der Zug hatte heute Morgen wieder Verspätung.',
      'Ich habe mir einen Tee gemacht und mich ans Fenster gesetzt.',
    ],
    question: [
      'Möchtest du später vorbeikommen?',
      'Hast du meinen blauen Regenschirm gesehen?',
      'Ist dieser Platz noch frei?',
      'Könntest du bitte das Fenster öffnen?',
      'Treffen wir uns am Montag noch?',
      'Hast du daran gedacht, beim Arzt anzurufen?',
    ],
    list: [
      'Ich habe Äpfel, Zitronen, Brot und Honig gekauft.',
      'Wir brauchen Milch, Eier, Mehl und Butter.',
      'Sie spricht Deutsch, Englisch, Italienisch und Spanisch.',
      'Am Montag, Mittwoch und Freitag gehe ich schwimmen.',
    ],
    lively: [
      'Das sind ja wunderbare Neuigkeiten, ich freue mich so für dich!',
      'Ich kann kaum glauben, wie schön dieser Garten ist!',
      'Was für eine schöne Überraschung, dich hier zu sehen!',
      'Du glaubst nicht, was mir heute passiert ist!',
      'Wow, das hast du wirklich alles selbst gemacht!',
    ],
  },
};

// Builds timed segments for a resonance take, after a get-ready lead-in.
export const RESONANCE_LEAD = 2;
function timeline(parts, seconds, gap) {
  let at = RESONANCE_LEAD;
  const segments = parts.map((part) => {
    const segment = { ...part, start: at, end: at + seconds };
    at += seconds + gap;
    return segment;
  });
  return { segments, total: at - gap + 0.5 };
}

function contrast(id, vowel, title) {
  return {
    id,
    vowel,
    title,
    pitchTarget: true,
    howTo: 'Stay on the same note. First make the sound big and dark, then keep the note and make the space in your throat smaller and brighter.',
    ...timeline([
      { vowel, cue: `Darker: ${vowel === 'ee' ? '"ee"' : '"ah"'}`, detail: 'Big-dog sound, throat open and long' },
      { vowel, cue: `Brighter: ${vowel === 'ee' ? '"ee"' : '"ah"'}`, detail: 'Small-dog sound, same note, no pushing' },
    ], 3.5, 1.5),
  };
}

export const RESONANCE = {
  check: {
    id: 'check',
    title: 'Resonance check',
    howTo: 'Hold each vowel at an easy, steady pitch, following the prompts. Keep the mic at the same distance every time, so that checks are comparable.',
    pitchTarget: false,
    ...timeline([
      { vowel: 'ee', cue: 'Hold "ee"', detail: 'as in "see" / German "Sie"' },
      { vowel: 'ah', cue: 'Hold "ah"', detail: 'as in "father" / German "Vater"' },
      { vowel: 'oo', cue: 'Hold "oo"', detail: 'as in "food" / German "Mut"' },
    ], 3, 1.2),
  },
  contrastEe: contrast('contrastEe', 'ee', 'Darker to brighter: "ee"'),
  contrastAh: contrast('contrastAh', 'ah', 'Darker to brighter: "ah"'),
};

export const TECHNIQUES = [
  { title: 'Big dog, small dog', body: 'Pant silently like a big dog, then like a tiny one. Feel the space in your throat get smaller and your voice box lift a little. This is the main movement.' },
  { title: 'Whispered "ee"', body: 'Whisper a long "ee" and let it get thinner and higher, like a small-dog pant. Then add a soft voice without losing that shape.' },
  { title: 'Tongue and lips', body: 'Keep your tongue high and forward, as for "ee", and your lips slightly spread, as in a gentle smile. A long, rounded mouth makes the sound darker.' },
  { title: 'Stay loose', body: 'Your throat should never squeeze. If it feels tight or your voice gets thin and pinched, release, swallow and start more gently.' },
];

export const RESONANCE_SENTENCES = {
  en: 'Many people were walking near the lake in the early morning.',
  de: 'Viele Leute gingen am frühen Morgen an dem Ufer des Sees entlang.',
};

export const BASELINE_SENTENCES = {
  en: 'The bakery on the corner opens at seven, and I usually get there a little after that.',
  de: 'Die Bäckerei an der Ecke öffnet um sieben, und ich bin meistens kurz danach dort.',
};
