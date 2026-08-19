import React, { useState, useEffect, useRef, useCallback } from "react";

/* ==================================================================
   SETUP — set BASE to the folder your 23 files sit in, ending with /
   Filenames below match your folder exactly. Don't rename the files.
   ================================================================== */

const BASE = `${import.meta.env.BASE_URL}audio/`;

/* Building blocks — these are what you assemble custom kriyas from.
   No teacher = the recording everyone uses.                          */
const FILES = [
  { practice: "Padmasadhana",    teacher: "Vishal",        file: "Vishal - Padmasadhana.mp3" },
  { practice: "Padmasadhana",    teacher: "Mayur Karthik", file: "Mayur Karthik - Padmasadhana.mp3" },
  { practice: "Bhogar Pranayam",                           file: "Bhogar Pranayam.mp3" },
  { practice: "Mudra Pranayam",                            file: "Mudra Pranayams.mp3" },
  { practice: "3 Stage",         teacher: "Dinesh",        file: "3-Stage - Dinesh.mp3" },
  { practice: "Bhastrika",       teacher: "Dinesh",        file: "Bhastrika - Dinesh.mp3" },
  { practice: "3 Stage + Bhastrika (Fast)", id: "fast-kriya-practice", file: "Fast Kriya - Annales.mp3" },
  { practice: "Sanyam 2 Bells",                            file: "Sanyam 2 Bells.mp3" },
  { practice: "Sahaj",           teacher: "Bhanu Di",      variant: "Regular", file: "BhanuDiSahaj.mp3" },
  { practice: "Sahaj",           teacher: "Bhanu Di",      variant: "Trimmed", file: "BhanuDiSahaj-Trimmed.mp3" },
  { practice: "Sahaj",                                     variant: "Silent",  file: "Sahaj Empty.mp3" },
  { practice: "Samaveda",                                  variant: "Long",    file: "Samaveda - Long.mp3" },
  { practice: "Samaveda",                                  variant: "Short",   file: "Samaveda - Short.mp3" },
  { practice: "OM",              teacher: "Dinesh",        file: "OM - Dinesh.mp3" },
  { practice: "Kriya",                                     variant: "Silent",  file: "Kriya - Empty Audio.mp3" },
];

/* Full kriyas — one recording, start to finish, one tap on the home screen. */
const FULL = [
  { name: "Regular Kriya",    teacher: "Dinesh",     file: "Dinesh-Kriya.mp3" },
  { name: "Sanyam 2 Full",    teacher: "Vishal",     file: "Visham Sanyam 2 Full Refined.mp3" },
  { name: "Sanyam 2 Evening", teacher: "Vishal",     file: "Vishal - Evening Sanyam 2 Refined.mp3" },
  { name: "Sanyam 2 Full",    teacher: "Kashi Bhai", file: "Kashi Bhaiyya - Full Sanyam 2.mp3" },
  { name: "Sanyam 2 Evening", teacher: "Kashi Bhai", file: "Kashi Bhaiyya - Sanyam 2 evening.mp3" },
  { name: "Fast Kriya",                              variant: "Annales", file: "Fast Kriya - Annales.mp3" },
];

const TEACHERS = ["General", "Vishal", "Kashi Bhai", "Dinesh", "Mayur Karthik", "Bhanu Di"];

/* Full kriyas shown under the General tab, regardless of who teaches them. */
const GENERAL_FILES = ["Fast Kriya - Annales.mp3", "Dinesh-Kriya.mp3"];

/* ================================================================== */

const STORE_KEY = "kriya-store";
const PAUSE_CHOICES = [5, 10, 15, 30, 60, 120, 300];

/* true when you host this yourself; localStorage is blocked in Claude */
const USE_LOCAL_STORAGE = true;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const urlFor = (file) => BASE + encodeURIComponent(file);

const LIBRARY = FILES.map((f) => ({
  ...f, id: f.id || slug(f.file), kind: "practice", url: urlFor(f.file),
}));
const PATH_TRACKS = FULL.map((f) => ({
  ...f, practice: f.name, id: slug(f.file), kind: "full", url: urlFor(f.file),
}));
const ALL = [...LIBRARY, ...PATH_TRACKS];
const PRACTICES = [...new Set(LIBRARY.map((t) => t.practice))];
const SHARED_FULL = PATH_TRACKS.filter((t) => !t.teacher && !GENERAL_FILES.includes(t.file));

/* ---------------------------- storage ----------------------------- */
/* { sequences: [...], teacher: "Vishal", durations: { id: seconds } } */

async function loadStore() {
  try {
    if (USE_LOCAL_STORAGE) {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    if (!window.storage) return null;
    const r = await window.storage.get(STORE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch (e) { return null; }
}

async function saveStore(data) {
  try {
    if (USE_LOCAL_STORAGE) {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    }
    if (!window.storage) return false;
    await window.storage.set(STORE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

/* ---------------------------- helpers ----------------------------- */

const uid = () => Math.random().toString(36).slice(2, 9);

function fmt(sec) {
  if (sec == null || !isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function fmtLong(sec) {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const tagOf = (t) => [t.variant, t.teacher].filter(Boolean).join(" · ");

/* ------------------------------ app ------------------------------- */

export default function App() {
  const [teacher, setTeacher] = useState(TEACHERS[0]);
  const [sequences, setSequences] = useState([]);
  const [durations, setDurations] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(true);

  const [view, setView] = useState("home");
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [toast, setToast] = useState(null);

  const audioA = useRef(null);
  const audioB = useRef(null);
  const trackById = (id) => ALL.find((t) => t.id === id);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await loadStore();
      if (!alive) return;
      if (d) {
        setSequences(Array.isArray(d.sequences) ? d.sequences : []);
        setDurations(d.durations || {});
        if (d.teacher && TEACHERS.includes(d.teacher)) setTeacher(d.teacher);
      }
      if (!USE_LOCAL_STORAGE && !window.storage) setCanSave(false);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      saveStore({ sequences, teacher, durations }).then((ok) => { if (!ok) setCanSave(false); });
    }, 400);
    return () => clearTimeout(id);
  }, [sequences, teacher, durations, loaded]);

  /* read lengths once, cache them */
  useEffect(() => {
    if (!loaded) return;
    ALL.forEach((t) => {
      if (durations[t.id]) return;
      const probe = document.createElement("audio");
      probe.preload = "metadata";
      probe.src = t.url;
      probe.onloadedmetadata = () => {
        if (isFinite(probe.duration))
          setDurations((prev) => ({ ...prev, [t.id]: probe.duration }));
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const seqDuration = (s) => s.steps.reduce((a, st) => a + (st.p ? st.p : durations[st.t] || 0), 0);
  const playOne = (t, name) => {
    setPlaying({ name: name || t.practice, steps: [{ t: t.id, k: "1" }] });
    setView("play");
  };

  return (
    <div className="k-root">
      <Styles />
      <audio ref={audioA} preload="auto" />
      <audio ref={audioB} preload="auto" />

      {view === "home" && (
        <Home
          teacher={teacher} setTeacher={setTeacher}
          sequences={sequences} seqDuration={seqDuration} durations={durations} canSave={canSave}
          onPlayTrack={playOne}
          onPlaySeq={(s) => { setPlaying(s); setView("play"); }}
          onEdit={(s) => { setEditing(JSON.parse(JSON.stringify(s))); setView("build"); }}
          onNew={() => { setEditing({ id: uid(), name: "", steps: [] }); setView("build"); }}
          onLibrary={() => setView("library")}
        />
      )}

      {view === "build" && (
        <Builder
          seq={editing} teacher={teacher} durations={durations} trackById={trackById}
          onChange={setEditing}
          onSave={(s) => {
            const named = { ...s, name: s.name.trim() || "Untitled kriya" };
            setSequences((prev) => {
              const i = prev.findIndex((x) => x.id === named.id);
              if (i === -1) return [...prev, named];
              const c = [...prev]; c[i] = named; return c;
            });
            setView("home"); flash("Kriya saved");
          }}
          onDelete={(id) => { setSequences((p) => p.filter((s) => s.id !== id)); setView("home"); }}
          onCancel={() => setView("home")}
        />
      )}

      {view === "library" && <LibraryView durations={durations} onBack={() => setView("home")} />}

      {view === "play" && playing && (
        <Player
          audioA={audioA} audioB={audioB} seq={playing}
          trackById={trackById} durations={durations}
          onExit={() => { setView("home"); setPlaying(null); }}
        />
      )}

      {toast && <div className="k-toast">{toast}</div>}
    </div>
  );
}

/* ------------------------------ home ------------------------------ */

function Home({ teacher, setTeacher, sequences, seqDuration, durations, canSave,
                onPlayTrack, onPlaySeq, onEdit, onNew, onLibrary }) {

  const theirFull = teacher === "General"
    ? PATH_TRACKS.filter((t) => GENERAL_FILES.includes(t.file))
    : PATH_TRACKS.filter((t) => t.teacher === teacher);
  const theirSolo = teacher === "General" ? [] : LIBRARY.filter((t) => t.teacher === teacher);

  const row = (t, label) => (
    <button key={t.id} className="k-card k-row" onClick={() => onPlayTrack(t, label || t.name)}>
      <span>
        <span className="k-display k-rowname">{label || t.name || t.practice}</span>
        {t.variant && <span className="k-tag">{t.variant}</span>}
        <span className="k-sub k-mono k-small">{durations[t.id] ? fmtLong(durations[t.id]) : "—"}</span>
      </span>
      <span className="k-play" aria-hidden="true" />
    </button>
  );

  return (
    <div className="k-fade">
      <header className="k-head">
        <div>
          <div className="k-eyebrow">Sadhana</div>
          <h1 className="k-display k-h1">Kriya</h1>
        </div>
        <button className="k-ghost" onClick={onLibrary}>Recordings</button>
      </header>

      <div className="k-teacherbar">
        <span className="k-eyebrow">Guided by</span>
        <div className="k-teacherrow">
          {TEACHERS.map((t) => (
            <button key={t} className={"k-teacher" + (t === teacher ? " k-teacher-on" : "")}
              onClick={() => setTeacher(t)}>{t}</button>
          ))}
        </div>
      </div>

      {theirFull.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">Full kriyas</div>
          <div className="k-list k-mt-s">{theirFull.map((t) => row(t))}</div>
        </>
      )}

      {theirFull.length === 0 && theirSolo.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">{teacher}</div>
          <div className="k-list k-mt-s">{theirSolo.map((t) => row(t, t.practice))}</div>
        </>
      )}

      {SHARED_FULL.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">Any teacher</div>
          <div className="k-list k-mt-s">{SHARED_FULL.map((t) => row(t))}</div>
        </>
      )}

      <div className="k-headrow k-mt">
        <span className="k-eyebrow">My kriyas</span>
        <button className="k-ghost" onClick={onNew}>+ New</button>
      </div>

      {sequences.length === 0 ? (
        <p className="k-sub">
          Nothing built yet. String the practices together — a short one for
          weekday mornings, a long one for Sundays.
        </p>
      ) : (
        <div className="k-list k-mt-s">
          {sequences.map((s) => {
            const d = seqDuration(s);
            return (
              <div key={s.id} className="k-card k-seqcard">
                <button className="k-seqmain" onClick={() => onPlaySeq(s)}>
                  <div>
                    <div className="k-display k-rowname">{s.name}</div>
                    <div className="k-sub k-mono k-small">
                      {s.steps.filter((x) => x.t).length} practices{d ? ` · ${fmtLong(d)}` : ""}
                    </div>
                    <div className="k-thread">
                      {s.steps.map((st, i) => (
                        <span key={st.k || i} className={st.p ? "k-bead k-bead-sm" : "k-bead"} />
                      ))}
                    </div>
                  </div>
                  <span className="k-play" aria-hidden="true" />
                </button>
                <button className="k-edit" onClick={() => onEdit(s)}>Edit</button>
              </div>
            );
          })}
        </div>
      )}

      <p className="k-foot">
        {canSave
          ? "Your kriyas, your teacher and the track lengths are saved on this device."
          : "Saving is unavailable here — kriyas will last for this session only."}
      </p>
    </div>
  );
}

/* ----------------------------- builder ---------------------------- */

function Builder({ seq, teacher, durations, trackById, onChange, onSave, onDelete, onCancel }) {
  const [open, setOpen] = useState(null);
  const set = (patch) => onChange({ ...seq, ...patch });

  const versionsOf = (practice) => {
    const v = LIBRARY.filter((t) => t.practice === practice);
    return [...v].sort((a, b) => (b.teacher === teacher) - (a.teacher === teacher));
  };

  const pick = (practice) => {
    const v = versionsOf(practice);
    if (v.length === 1) return add(v[0].id);
    const mine = v.filter((x) => x.teacher === teacher);
    if (mine.length === 1) return add(mine[0].id);
    setOpen(open === practice ? null : practice);
  };

  const add = (tid) => { set({ steps: [...seq.steps, { t: tid, k: uid() }] }); setOpen(null); };
  const addPause = () => set({ steps: [...seq.steps, { p: 15, k: uid() }] });

  const move = (i, dir) => {
    const s = [...seq.steps], j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    set({ steps: s });
  };
  const cyclePause = (i) => {
    const s = [...seq.steps];
    s[i] = { ...s[i], p: PAUSE_CHOICES[(PAUSE_CHOICES.indexOf(s[i].p) + 1) % PAUSE_CHOICES.length] };
    set({ steps: s });
  };
  const swapVersion = (i, tid) => {
    const s = [...seq.steps];
    s[i] = { ...s[i], t: tid };
    set({ steps: s });
  };

  const total = seq.steps.reduce((a, st) => a + (st.p ? st.p : durations[st.t] || 0), 0);

  return (
    <div className="k-fade">
      <header className="k-head">
        <button className="k-ghost" onClick={onCancel}>Back</button>
        <button className="k-btn k-primary" disabled={!seq.steps.length} onClick={() => onSave(seq)}>Save</button>
      </header>

      <input className="k-display k-nameinput" placeholder="Name this kriya"
        value={seq.name} onChange={(e) => set({ name: e.target.value })} />

      <div className="k-headrow k-mt">
        <span className="k-eyebrow">The sequence</span>
        {total > 0 && <span className="k-mono k-dim k-small">{fmtLong(total)}</span>}
      </div>

      {seq.steps.length === 0 && <p className="k-sub">Empty. Add a practice below.</p>}

      <ol className="k-steps">
        {seq.steps.map((st, i) => {
          const t = st.t ? trackById(st.t) : null;
          const sibs = t ? LIBRARY.filter((x) => x.practice === t.practice) : [];
          return (
            <li key={st.k || i} className="k-step">
              <span className={st.p ? "k-bead k-bead-sm" : "k-bead"} />
              {st.p ? (
                <button className="k-steplabel k-pause" onClick={() => cyclePause(i)}>
                  Silence <span className="k-mono">{fmt(st.p)}</span>
                  <span className="k-hint">tap to change</span>
                </button>
              ) : (
                <span className="k-steplabel">
                  <span className="k-display k-stepname">{t ? t.practice : "Missing"}</span>
                  {t && sibs.length > 1 ? (
                    <select className="k-select" value={t.id} onChange={(e) => swapVersion(i, e.target.value)}>
                      {sibs.map((x) => <option key={x.id} value={x.id}>{tagOf(x) || "Default"}</option>)}
                    </select>
                  ) : t && tagOf(t) ? <span className="k-tag">{tagOf(t)}</span> : null}
                  {t && durations[t.id] && <span className="k-mono k-dim k-small">{fmt(durations[t.id])}</span>}
                </span>
              )}
              <span className="k-stepbtns">
                <button className="k-icon" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="k-icon" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="k-icon" onClick={() => set({ steps: seq.steps.filter((_, x) => x !== i) })} aria-label="Remove">×</button>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="k-eyebrow k-mt">Add a practice</div>
      <div className="k-chiprow">
        {PRACTICES.map((p) => (
          <button key={p} className={"k-chip" + (open === p ? " k-chip-on" : "")} onClick={() => pick(p)}>{p}</button>
        ))}
        <button className="k-chip k-chip-alt" onClick={addPause}>+ Silence</button>
      </div>

      {open && (
        <div className="k-card k-mt-s">
          <div className="k-eyebrow">{open} — which one</div>
          <div className="k-chiprow">
            {versionsOf(open).map((v) => (
              <button key={v.id} className="k-chip k-chip-sm" onClick={() => add(v.id)}>
                {tagOf(v) || "Default"}
                {durations[v.id] ? <span className="k-mono k-dim k-small"> {fmt(durations[v.id])}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="k-mt">
        <button className="k-danger" onClick={() => onDelete(seq.id)}>Delete this kriya</button>
      </div>
    </div>
  );
}

/* ---------------------------- recordings -------------------------- */

function LibraryView({ durations, onBack }) {
  const [preview, setPreview] = useState(null);
  const el = useRef(null);

  const toggle = (t) => {
    if (!el.current) return;
    if (preview === t.id) { el.current.pause(); setPreview(null); }
    else { el.current.src = t.url; el.current.play().catch(() => {}); setPreview(t.id); }
  };

  const group = (title, items) => (
    <div key={title} className="k-card k-group">
      <div className="k-display k-groupname">{title}</div>
      {items.map((t) => (
        <div key={t.id} className="k-verrow">
          <span className="k-verleft">
            <span className="k-tag">{tagOf(t) || "Default"}</span>
            <span className="k-mono k-dim k-small k-file">{t.file}</span>
          </span>
          <span className="k-verright">
            <span className="k-mono k-dim k-small">{durations[t.id] ? fmt(durations[t.id]) : "—"}</span>
            <button className="k-ghost" onClick={() => toggle(t)}>{preview === t.id ? "Stop" : "Play"}</button>
          </span>
        </div>
      ))}
    </div>
  );

  const fullNames = [...new Set(PATH_TRACKS.map((t) => t.name))];

  return (
    <div className="k-fade">
      <header className="k-head">
        <button className="k-ghost" onClick={onBack}>Back</button>
        <div className="k-eyebrow">Recordings</div>
      </header>
      <audio ref={el} onEnded={() => setPreview(null)} />

      <p className="k-sub">
        A dash instead of a length means that file didn’t load — check the name
        matches your folder exactly.
      </p>

      <div className="k-eyebrow k-mt">Practices</div>
      <div className="k-list k-mt-s">
        {PRACTICES.map((p) => group(p, LIBRARY.filter((t) => t.practice === p)))}
      </div>

      <div className="k-eyebrow k-mt">Full kriyas</div>
      <div className="k-list k-mt-s">
        {fullNames.map((n) => group(n, PATH_TRACKS.filter((t) => t.name === n)))}
      </div>
    </div>
  );
}

/* ------------------------------ player ---------------------------- */

function Player({ audioA, audioB, seq, trackById, durations, onExit }) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const timer = useRef(null);

  const step = seq.steps[index];
  const done = index >= seq.steps.length;
  const track = step && step.t ? trackById(step.t) : null;
  const next = useCallback(() => setIndex((i) => i + 1), []);

  /* audio steps alternate across two elements, so the next recording
     buffers while the current one is still playing                    */
  const audioSteps = seq.steps.map((s, i) => (s.t ? i : -1)).filter((i) => i >= 0);
  const elFor = (i) => {
    const n = audioSteps.indexOf(i);
    return n < 0 ? null : (n % 2 === 0 ? audioA.current : audioB.current);
  };
  const warm = (from) => {
    const j = audioSteps.find((i) => i > from);
    if (j == null) return;
    const t = trackById(seq.steps[j].t);
    const el = elFor(j);
    if (!t || !el || el.dataset.url === t.url) return;
    el.dataset.url = t.url;
    el.src = t.url;
    el.load();
  };

  useEffect(() => {
    const cur = elFor(index);
    if (done) {
      [audioA.current, audioB.current].forEach((a) => a && a.pause());
      return;
    }
    clearInterval(timer.current);
    setElapsed(0); setStatus(null);

    if (step.p) {
      [audioA.current, audioB.current].forEach((a) => a && a.pause());
      setTotal(step.p);
      warm(index);
      let e = 0;
      timer.current = setInterval(() => {
        e += 0.25; setElapsed(e);
        if (e >= step.p) { clearInterval(timer.current); next(); }
      }, 250);
      return () => clearInterval(timer.current);
    }

    if (!track || !cur) { next(); return; }
    const other = cur === audioA.current ? audioB.current : audioA.current;
    if (other) other.pause();

    const ready = cur.dataset.url === track.url;
    if (!ready) { cur.dataset.url = track.url; cur.src = track.url; }
    cur.currentTime = 0;
    setTotal(durations[track.id] || (isFinite(cur.duration) ? cur.duration : 0));
    setStatus(ready && cur.readyState >= 3 ? null : "loading");

    const p = cur.play();
    if (p && p.catch) p.catch(() => setStatus("blocked"));

    const onPlaying = () => { setStatus(null); warm(index); };
    const onEnd = () => next();
    const onMeta = () => setTotal(cur.duration);
    const onErr = () => setStatus("error");
    cur.addEventListener("playing", onPlaying);
    cur.addEventListener("ended", onEnd);
    cur.addEventListener("loadedmetadata", onMeta);
    cur.addEventListener("error", onErr);
    timer.current = setInterval(() => setElapsed(cur.currentTime), 250);
    return () => {
      cur.removeEventListener("playing", onPlaying);
      cur.removeEventListener("ended", onEnd);
      cur.removeEventListener("loadedmetadata", onMeta);
      cur.removeEventListener("error", onErr);
      clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done]);

  useEffect(() => {
    if (!step || !step.p) return;
    clearInterval(timer.current);
    if (!isPlaying) return;
    let e = elapsed;
    timer.current = setInterval(() => {
      e += 0.25; setElapsed(e);
      if (e >= step.p) { clearInterval(timer.current); next(); }
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  useEffect(() => {
    let lock = null;
    if (isPlaying && navigator.wakeLock)
      navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => { try { lock && lock.release(); } catch (e) {} };
  }, [isPlaying]);

  useEffect(() => () => {
    [audioA.current, audioB.current].forEach((a) => {
      if (!a) return;
      a.pause(); a.removeAttribute("src"); delete a.dataset.url; a.load();
    });
    clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const cur = elFor(index);
    if (isPlaying) { if (!step.p && cur) cur.pause(); setPlaying(false); }
    else {
      if (!step.p && cur) { const p = cur.play(); if (p && p.catch) p.catch(() => setStatus("blocked")); }
      setStatus(null); setPlaying(true);
    }
  };
  const skip = (d) => { setPlaying(true); setIndex(Math.min(seq.steps.length, Math.max(0, index + d))); };

  const pct = total ? Math.min(100, (elapsed / total) * 100) : 0;
  const R = 86, C = 2 * Math.PI * R;

  if (done) {
    return (
      <div className="k-fade k-center k-player">
        <div className="k-eyebrow">{seq.name}</div>
        <h2 className="k-display k-h1 k-mt">Complete</h2>
        <p className="k-sub">Sit for as long as you like.</p>
        <button className="k-btn k-primary k-wide k-mt" onClick={onExit}>Done</button>
      </div>
    );
  }

  const tag = step.p ? "" : track ? tagOf(track) : "";

  return (
    <div className="k-fade k-player">
      <header className="k-head">
        <button className="k-ghost" onClick={onExit}>Close</button>
        <div className="k-eyebrow">{seq.name}</div>
      </header>

      <div className="k-ring-wrap">
        <svg viewBox="0 0 200 200" className={isPlaying ? "k-ring k-breathe" : "k-ring"}>
          <circle cx="100" cy="100" r={R} className="k-ring-track" />
          <circle cx="100" cy="100" r={R} className="k-ring-fill"
            strokeDasharray={C} strokeDashoffset={C - (C * pct) / 100} />
        </svg>
        <div className="k-ring-inner">
          <div className="k-mono k-time">{fmt(elapsed)}</div>
          <div className="k-mono k-dim k-small">{total ? `of ${fmt(total)}` : ""}</div>
        </div>
      </div>

      <div className="k-center">
        <div className="k-display k-nowplaying">
          {step.p ? "Silence" : track ? track.practice : "—"}
        </div>
        {tag && <div className="k-tag k-tag-lg">{tag}</div>}
        {seq.steps.length > 1 && (
          <div className="k-eyebrow k-mt-s">step {index + 1} of {seq.steps.length}</div>
        )}
      </div>

      {seq.steps.length > 1 && (
        <div className="k-thread k-thread-lg">
          {seq.steps.map((st, i) => (
            <span key={st.k || i}
              className={(st.p ? "k-bead k-bead-sm" : "k-bead") +
                (i === index ? " k-bead-on" : i < index ? " k-bead-past" : "")} />
          ))}
        </div>
      )}

      {status === "loading" && <p className="k-sub k-center">Loading…</p>}
      {status === "blocked" && <p className="k-warn k-center">Tap play to continue.</p>}
      {status === "error" && <p className="k-warn k-center">This recording wouldn’t load. Check the link, or skip ahead.</p>}

      <div className="k-controls">
        <button className="k-circle" onClick={() => skip(-1)} aria-label="Previous">‹</button>
        <button className="k-circle k-big" onClick={toggle} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? "❙❙" : "▶"}
        </button>
        <button className="k-circle" onClick={() => skip(1)} aria-label="Next">›</button>
      </div>
    </div>
  );
}

/* ------------------------------ styles ---------------------------- */

function Styles() {
  return (
    <style>{`
.k-root, .k-root *, .k-root *::before, .k-root *::after { box-sizing:border-box; }
.k-root {
  --line:#2E3852; --sandal:#EFE6D6; --muted:#8D96AB; --amber:#E9A94A; --sage:#7FB3A6; --slate:#232C40;
  min-height:100vh; margin:0 auto; max-width:560px; padding:22px 18px 40px;
  background:radial-gradient(130% 70% at 50% -15%, #1D2436 0%, #0D1018 62%);
  color:var(--sandal); font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.k-display { font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif; }
.k-mono { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
.k-eyebrow { font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); }
.k-h1 { font-size:34px; margin:2px 0 0; font-weight:500; }
.k-sub { font-size:13px; color:var(--muted); line-height:1.6; margin:6px 0 0; display:block; }
.k-dim { color:var(--muted); } .k-small { font-size:11px; }
.k-mt { margin-top:24px; } .k-mt-s { margin-top:10px; } .k-center { text-align:center; }
.k-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; }
.k-headrow { display:flex; align-items:center; justify-content:space-between; gap:10px; }

.k-teacherbar { border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:12px 0; }
.k-teacherrow { display:flex; gap:8px; overflow-x:auto; margin-top:9px; padding-bottom:2px; }
.k-teacher { flex:none; background:none; border:1px solid var(--line); color:var(--muted);
  border-radius:999px; padding:8px 15px; font-size:13px; cursor:pointer; white-space:nowrap; }
.k-teacher-on { color:#12151F; background:var(--sandal); border-color:var(--sandal); font-weight:600; }

.k-card { background:linear-gradient(180deg,#19212F,#131926); border:1px solid var(--line); border-radius:20px; padding:16px; }
.k-list { display:flex; flex-direction:column; gap:10px; }
.k-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:14px;
  color:inherit; text-align:left; cursor:pointer; }
.k-rowname { font-size:20px; font-weight:500; display:block; margin-bottom:4px; }
.k-play { width:44px; height:44px; flex:none; border-radius:50%; background:var(--amber); position:relative; }
.k-play::after { content:""; position:absolute; top:50%; left:54%; transform:translate(-50%,-50%);
  border-left:13px solid #10131C; border-top:9px solid transparent; border-bottom:9px solid transparent; }
.k-seqcard { padding:0; overflow:hidden; }
.k-seqmain { width:100%; display:flex; align-items:center; justify-content:space-between; gap:14px;
  background:none; border:0; color:inherit; text-align:left; padding:16px 16px 12px; cursor:pointer; }
.k-edit { width:100%; background:rgba(255,255,255,.03); border:0; border-top:1px solid var(--line);
  color:var(--muted); padding:11px; font-size:12px; letter-spacing:.14em; text-transform:uppercase; cursor:pointer; }

.k-tag { font-size:12px; letter-spacing:.08em; color:var(--sage); background:rgba(127,179,166,.1);
  border:1px solid rgba(127,179,166,.25); border-radius:999px; padding:3px 10px; display:inline-block; }
.k-tag-lg { font-size:13px; margin-top:2px; }
.k-file { display:block; margin-top:5px; opacity:.6; word-break:break-all; }

.k-thread { display:flex; align-items:center; gap:7px; margin-top:12px; flex-wrap:wrap; }
.k-thread-lg { justify-content:center; gap:10px; margin:24px 0; }
.k-bead { width:11px; height:11px; border-radius:50%; background:var(--slate);
  border:1px solid var(--line); flex:none; transition:all .4s ease; }
.k-bead-sm { width:5px; height:5px; background:transparent; border-color:var(--muted); }
.k-bead-past { background:var(--sage); border-color:var(--sage); opacity:.45; }
.k-bead-on { background:var(--amber); border-color:var(--amber); transform:scale(1.45);
  box-shadow:0 0 14px rgba(233,169,74,.55); }

.k-btn { border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--sandal);
  border-radius:999px; padding:13px 22px; font-size:15px; cursor:pointer; }
.k-btn:disabled { opacity:.4; }
.k-primary { background:var(--amber); border-color:var(--amber); color:#12151F; font-weight:600; }
.k-wide { display:block; width:100%; margin-top:14px; }
.k-ghost { background:none; border:0; color:var(--muted); font-size:13px; letter-spacing:.1em;
  text-transform:uppercase; cursor:pointer; padding:8px 2px; }
.k-danger { background:none; border:0; color:#C97A73; font-size:13px; cursor:pointer; padding:8px 0; }

.k-chiprow { display:flex; flex-wrap:wrap; gap:9px; margin-top:12px; }
.k-chip { background:rgba(255,255,255,.05); border:1px solid var(--line); color:var(--sandal);
  border-radius:999px; padding:11px 16px; font-size:14px; cursor:pointer; }
.k-chip-on { border-color:var(--amber); color:var(--amber); }
.k-chip-sm { padding:9px 14px; font-size:13px; }
.k-chip-alt { border-style:dashed; color:var(--muted); }

.k-nameinput { width:100%; background:none; border:0; border-bottom:1px solid var(--line);
  color:var(--sandal); font-size:26px; padding:8px 0; outline:none; }
.k-nameinput:focus { border-color:var(--amber); }

.k-steps { list-style:none; margin:10px 0 0; padding:0; }
.k-step { display:flex; align-items:center; gap:11px; padding:12px 2px; border-bottom:1px solid rgba(46,56,82,.5); }
.k-steplabel { flex:1; background:none; border:0; color:inherit; text-align:left;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.k-stepname { font-size:17px; }
.k-select { background:rgba(127,179,166,.1); border:1px solid rgba(127,179,166,.25); color:var(--sage);
  border-radius:999px; padding:4px 8px; font-size:12px; outline:none; }
.k-pause { color:var(--muted); font-size:15px; cursor:pointer; }
.k-hint { font-size:10px; letter-spacing:.12em; text-transform:uppercase; opacity:.6; }
.k-stepbtns { display:flex; gap:4px; flex:none; }
.k-icon { width:34px; height:34px; border-radius:10px; border:1px solid var(--line);
  background:rgba(255,255,255,.03); color:var(--muted); font-size:15px; cursor:pointer; }
.k-warn { color:#D9A05B; font-size:13px; }

.k-group { padding:14px 16px; }
.k-groupname { font-size:18px; margin-bottom:6px; }
.k-verrow { display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:9px 0; border-top:1px solid rgba(46,56,82,.5); }
.k-verleft { min-width:0; }
.k-verright { display:flex; align-items:center; gap:12px; flex:none; }

.k-player { display:flex; flex-direction:column; min-height:88vh; }
.k-ring-wrap { position:relative; width:230px; height:230px; margin:14px auto 6px; }
.k-ring { width:100%; height:100%; transform:rotate(-90deg); }
.k-ring-track { fill:none; stroke:rgba(255,255,255,.07); stroke-width:6; }
.k-ring-fill { fill:none; stroke:var(--amber); stroke-width:6; stroke-linecap:round;
  transition:stroke-dashoffset .3s linear; filter:drop-shadow(0 0 8px rgba(233,169,74,.35)); }
.k-ring-inner { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:4px; }
.k-time { font-size:32px; }
.k-nowplaying { font-size:27px; margin-bottom:8px; }
.k-controls { display:flex; align-items:center; justify-content:center; gap:26px; margin-top:auto; padding-top:24px; }
.k-circle { width:58px; height:58px; border-radius:50%; border:1px solid var(--line);
  background:rgba(255,255,255,.04); color:var(--sandal); font-size:24px; cursor:pointer; }
.k-big { width:82px; height:82px; background:var(--amber); border-color:var(--amber); color:#12151F; }

.k-toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%);
  background:#20293B; border:1px solid var(--line); color:var(--sandal);
  padding:12px 20px; border-radius:999px; font-size:14px; z-index:50; }
.k-foot { font-size:11px; color:var(--muted); line-height:1.7; margin-top:30px; }

.k-fade { animation:kfade .5s ease both; }
@keyframes kfade { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }
.k-breathe { animation:kbreathe 8s ease-in-out infinite; }
@keyframes kbreathe { 0%,100% { transform:rotate(-90deg) scale(1);} 50% { transform:rotate(-90deg) scale(1.035);} }
button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
@media (prefers-reduced-motion: reduce) {
  .k-fade, .k-breathe { animation:none; }
  .k-bead, .k-ring-fill { transition:none; }
}
`}</style>
  );
}
