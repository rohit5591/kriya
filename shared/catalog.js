/* ==================================================================
   The catalog, and who is allowed to hear which part of it.

   Imported by both the browser app and the Worker. The browser copy
   decides what to *show*; the Worker copy decides what to *serve*, and
   that second one is the one that matters — hiding a row in the UI
   stops nobody.
   ================================================================== */

/* The courses, in the order they're offered to an admin. */
export const COURSES = [
  { id: "part1",   name: "Part 1",            short: "Part 1"   },
  { id: "part2",   name: "Part 2 (Advanced)", short: "Part 2"   },
  { id: "sahaj",   name: "Sahaj Samadhi",     short: "Sahaj"    },
  { id: "sanyam2", name: "Sanyam 2",          short: "Sanyam 2" },
];

export const COURSE_IDS = COURSES.map((c) => c.id);
export const courseName = (id) => (COURSES.find((c) => c.id === id) || {}).name || id;

/* Doing a course carries what it builds on. Part 2 and Sahaj are both
   branches off Part 1 rather than rungs of one ladder, so neither
   implies the other; Sanyam 2 sits on top of everything. */
const IMPLIES = {
  part1:   ["part1"],
  part2:   ["part1", "part2"],
  sahaj:   ["part1", "sahaj"],
  sanyam2: ["part1", "part2", "sahaj", "sanyam2"],
};

/* grants (what someone was granted) -> the full set that opens up */
export function effectiveCourses(grants) {
  const out = new Set();
  (Array.isArray(grants) ? grants : []).forEach((g) =>
    (IMPLIES[g] || []).forEach((c) => out.add(c)));
  return out;
}

/* Building blocks — these are what you assemble custom kriyas from.
   No teacher = the recording everyone uses.                          */
const FILES = [
  { practice: "Padmasadhana",    teacher: "Vishal",        course: "part1",   file: "Vishal - Padmasadhana.mp3" },
  { practice: "Padmasadhana",    teacher: "Mayur Karthik", course: "part1",   file: "Mayur Karthik - Padmasadhana.mp3" },
  { practice: "Bhogar Pranayam",                           course: "sanyam2", file: "Bhogar Pranayam.mp3" },
  { practice: "Mudra Pranayam",                            course: "part2",   file: "Mudra Pranayams.mp3" },
  { practice: "3 Stage",         teacher: "Dinesh",        course: "part1",   file: "3-Stage - Dinesh.mp3" },
  { practice: "Bhastrika",       teacher: "Dinesh",        course: "part1",   file: "Bhastrika - Dinesh.mp3" },
  { practice: "3 Stage + Bhastrika (Fast)", id: "fast-kriya-practice", course: "part1", file: "Fast Kriya - Annales.mp3" },
  { practice: "Sanyam 2 Bells",                            course: "sanyam2", file: "Sanyam 2 Bells.mp3" },
  { practice: "Sahaj",           teacher: "Bhanu Di",      course: "sahaj",   variant: "Regular", file: "BhanuDiSahaj.mp3" },
  { practice: "Sahaj",           teacher: "Bhanu Di",      course: "sahaj",   variant: "Trimmed", file: "BhanuDiSahaj-Trimmed.mp3" },
  { practice: "Sahaj",                                     course: "sahaj",   variant: "Silent",  file: "Sahaj Empty.mp3" },
  { practice: "Samaveda",                                  course: "sanyam2", variant: "Long",    file: "Samaveda - Long.mp3" },
  { practice: "Samaveda",                                  course: "sanyam2", variant: "Short",   file: "Samaveda - Short.mp3" },
  { practice: "OM",              teacher: "Dinesh",        course: "part1",   file: "OM - Dinesh.mp3" },
  { practice: "Kriya",                                     course: "part1",   variant: "Silent",  file: "Kriya - Empty Audio.mp3" },
];

/* Full kriyas — one recording, start to finish, one tap on the home screen. */
const FULL = [
  { name: "Regular Kriya",    teacher: "Dinesh",     course: "part1",   file: "Dinesh-Kriya.mp3" },
  { name: "Sanyam 2 Full",    teacher: "Vishal",     course: "sanyam2", file: "Visham Sanyam 2 Full Refined.mp3" },
  { name: "Sanyam 2 Evening", teacher: "Vishal",     course: "sanyam2", file: "Vishal - Evening Sanyam 2 Refined.mp3" },
  { name: "Sanyam 2 Full",    teacher: "Kashi Bhai", course: "sanyam2", file: "Kashi Bhaiyya - Full Sanyam 2.mp3" },
  { name: "Sanyam 2 Evening", teacher: "Kashi Bhai", course: "sanyam2", file: "Kashi Bhaiyya - Sanyam 2 evening.mp3" },
  { name: "Fast Kriya",                              course: "part1",   variant: "Annales", file: "Fast Kriya - Annales.mp3" },
];

export const TEACHERS = ["General", "Vishal", "Kashi Bhai", "Dinesh", "Mayur Karthik", "Bhanu Di"];

/* Full kriyas shown under the General tab, regardless of who teaches them. */
export const GENERAL_FILES = ["Fast Kriya - Annales.mp3", "Dinesh-Kriya.mp3"];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Where a recording is fetched from is the caller's business: gated, it
   is an id the Worker checks a session against; ungated (the plain
   static build), it is still the file sitting in public/. The catalog
   itself only knows the filename. */
export const apiAudioUrl = (t) => `/api/audio/${encodeURIComponent(t.id)}`;
/* Filenames carry spaces, which R2 keys survive badly (wrangler
   percent-encodes them on the way in, and then nothing matches). The
   key is the slugged filename instead — stable, unique per recording,
   and it leaves the names in public/audio alone. */
export const r2Key = (file) => `audio/${slug(file.replace(/\.mp3$/i, ""))}.mp3`;

export const LIBRARY = FILES.map((f) => ({
  ...f, id: f.id || slug(f.file), kind: "practice",
}));
export const PATH_TRACKS = FULL.map((f) => ({
  ...f, practice: f.name, id: slug(f.file), kind: "full",
}));
export const ALL_TRACKS = [...LIBRARY, ...PATH_TRACKS];

/* One recording can back two entries (Fast Kriya is both a practice and
   a full kriya), so this is a lookup by id, not by file. */
export const TRACK_BY_ID = new Map(ALL_TRACKS.map((t) => [t.id, t]));

/* The one question the Worker asks before it opens the bucket. */
export function mayPlay(trackId, grants) {
  const t = TRACK_BY_ID.get(trackId);
  if (!t) return false;
  return effectiveCourses(grants).has(t.course);
}

/* Everything the app can show a given person, derived once per sign-in.
   Anything they haven't been taught simply isn't in here. */
export function buildCatalog(grants, urlFor = apiAudioUrl) {
  const open = effectiveCourses(grants);
  const allowed = (t) => open.has(t.course);
  const dress = (t) => ({ ...t, url: urlFor(t) });

  const library = LIBRARY.filter(allowed).map(dress);
  const pathTracks = PATH_TRACKS.filter(allowed).map(dress);
  const all = [...library, ...pathTracks];

  return {
    courses: open,
    library, pathTracks, all,
    byId: new Map(all.map((t) => [t.id, t])),
    practices: [...new Set(library.map((t) => t.practice))],
    sharedFull: pathTracks.filter((t) => !t.teacher && !GENERAL_FILES.includes(t.file)),
    /* a teacher tab with nothing behind it is just a dead end */
    teachers: TEACHERS.filter((name) =>
      name === "General" || all.some((t) => t.teacher === name)),
  };
}
