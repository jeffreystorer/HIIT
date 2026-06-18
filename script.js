document.addEventListener('DOMContentLoaded', function() {

    // ── DOM refs ──────────────────────────────────────────────────────
    const timeDisplay = document.querySelector('.time');
    const phaseLabel = document.querySelector('.phase-label');
    const setDisplay = document.querySelector('.set-display');
    const repDisplay = document.querySelector('.rep-display');
    const workoutNameDisplay = document.querySelector('.workout-name-display');
    const playlistProgressDisplay = document.querySelector('.playlist-progress-display');
    const nextPhaseDisplay = document.querySelector('.next-phase-display');
    const totalDurationDisplay = document.querySelector('.total-duration-display');
    const startStopBtn = document.getElementById('start-stop');
    const resetBtn = document.getElementById('reset');
    const container = document.querySelector('.container');
    const progressBar = document.querySelector('.progress-bar');

    let activeWorkoutName = '';

    // ── Settings inputs ───────────────────────────────────────────────
    const intInputs = { sets: document.getElementById('sets'), reps: document.getElementById('reps') };
    const intLimits = { sets: { min: 1, max: 10 }, reps: { min: 1, max: 20 } };
    const mmssFields = ['work', 'rest', 'recover'];
    const mmssInputs = {};
    mmssFields.forEach(f => {
        mmssInputs[f] = { min: document.getElementById(f + '-min'), sec: document.getElementById(f + '-sec') };
    });
    const mmssMinTotal = { work: 1, rest: 0, recover: 0 };
    const mmssMaxTotal = 3600;
    const checkboxes = { rest: document.getElementById('rest-enabled'), recover: document.getElementById('recover-enabled') };
    const stepperDivs = { rest: document.getElementById('rest-stepper'), recover: document.getElementById('recover-stepper') };

    function getMmssTotal(field) {
        return parseInt(mmssInputs[field].min.value, 10) * 60 + parseInt(mmssInputs[field].sec.value, 10);
    }
    function setMmssTotal(field, totalSec) {
        totalSec = Math.max(mmssMinTotal[field], Math.min(mmssMaxTotal, totalSec));
        mmssInputs[field].min.value = Math.floor(totalSec / 60);
        mmssInputs[field].sec.value = totalSec % 60;
    }
    function applyCheckboxState(field) {
        stepperDivs[field].style.display = checkboxes[field].checked ? '' : 'none';
    }
    ['rest', 'recover'].forEach(field => {
        checkboxes[field].addEventListener('change', () => { if (!isRunning && !isPaused) applyCheckboxState(field); });
        applyCheckboxState(field);
    });

    // ── Phase config ──────────────────────────────────────────────────
    const phaseColors = { work: '#4caf50', rest: '#ffd166', recover: '#42a5f5', transition: '#b39ddb', countdown: '#ff6b6b' };
    const phaseNames  = { work: 'Work',   rest: 'Rest',    recover: 'Recover',  transition: 'Get Ready', countdown: 'Get Ready!' };

    // ── Stepper buttons ───────────────────────────────────────────────
    document.querySelectorAll('.stepper button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning || isPaused) return;
            const target = btn.dataset.target;
            const isUp = btn.classList.contains('step-up');
            const mmssMatch = target.match(/^(work|rest|recover)-(min|sec)$/);
            if (mmssMatch) {
                const [, field, part] = mmssMatch;
                let total = getMmssTotal(field);
                total += isUp ? (part === 'min' ? 60 : 1) : (part === 'min' ? -60 : -1);
                setMmssTotal(field, total);
                updateCirclePreview();
                return;
            }
            // Transition stepper (inside playlist editor) — handled separately
            if (target === 'transition-min' || target === 'transition-sec') return;
            const input = intInputs[target];
            if (!input) return;
            const { min, max } = intLimits[target];
            let value = parseInt(input.value, 10);
            input.value = isUp ? Math.min(max, value + 1) : Math.max(min, value - 1);
            updateCirclePreview();
        });
    });

    // ── Audio ─────────────────────────────────────────────────────────
    let audioContext, audioInitialized = false;
    function initAudio() {
        if (audioInitialized) return;
        try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); audioInitialized = true; }
        catch(e) { console.error('Audio init:', e); }
    }
    function playBeep(frequency = 800, duration = 150, type = 'sine') {
        if (!audioInitialized) { initAudio(); if (!audioInitialized) return; }
        try {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = type; osc.frequency.value = frequency;
            osc.connect(gain); gain.connect(audioContext.destination);
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(0.8, audioContext.currentTime + 0.01);
            gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
            osc.start(); osc.stop(audioContext.currentTime + duration / 1000);
        } catch(e) {}
    }
    // Distinct sounds per phase
    function playPhaseStart(type) {
        if (type === 'work')       { playBeep(880, 120); setTimeout(() => playBeep(1100, 120), 150); }
        else if (type === 'rest')  { playBeep(660, 200); }
        else if (type === 'recover') { playBeep(550, 300); }
        else if (type === 'transition') { playBeep(440, 150); setTimeout(() => playBeep(440, 150), 200); }
        else if (type === 'countdown') { playBeep(800, 80); }
    }
    function playCountdownBeep() { playBeep(1000, 80); }
    function playFinalBeep()     { playBeep(1200, 80); }
    function initAudioOnInteraction() {
        if (audioContext?.state === 'suspended') audioContext.resume();
        else if (!audioInitialized) initAudio();
    }
    document.addEventListener('click', initAudioOnInteraction, { once: true });
    document.addEventListener('keydown', initAudioOnInteraction, { once: true });
    initAudio();

    // ── Wake Lock ─────────────────────────────────────────────────────
    let wakeLock = null;
    async function requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try { wakeLock = await navigator.wakeLock.request('screen'); }
        catch(e) { console.warn('Wake lock failed:', e); }
    }
    function releaseWakeLock() {
        if (wakeLock) { wakeLock.release(); wakeLock = null; }
    }
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && isRunning) await requestWakeLock();
    });

    // ── Voice announcements ───────────────────────────────────────────
    function speak(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 1.1; utt.volume = 1;
        window.speechSynthesis.speak(utt);
    }

    // ── Schedule building ─────────────────────────────────────────────
    let isRunning = false, isPaused = false;
    let timerInterval;
    let schedule = [], stepIndex = 0, timeRemaining = 0, currentDuration = 0;

    function buildWorkoutSchedule(w) {
        const { sets, reps, name = '' } = w;
        const work    = w.work;
        const rest    = w.restEnabled    ? (w.rest    ?? 0) : 0;
        const recover = w.recoverEnabled ? (w.recover ?? 0) : 0;
        const seq = [];
        for (let s = 1; s <= sets; s++) {
            for (let r = 1; r <= reps; r++) {
                seq.push({ type: 'work', set: s, rep: r, totalSets: sets, totalReps: reps, workoutName: name, duration: work });
                if (r < reps && rest > 0)
                    seq.push({ type: 'rest', set: s, rep: r, totalSets: sets, totalReps: reps, workoutName: name, duration: rest });
            }
            if (s < sets && recover > 0)
                seq.push({ type: 'recover', set: s, rep: reps, totalSets: sets, totalReps: reps, workoutName: name, duration: recover });
        }
        return seq;
    }

    function buildSchedule() {
        return buildWorkoutSchedule({
            sets: parseInt(intInputs.sets.value, 10),
            reps: parseInt(intInputs.reps.value, 10),
            work: getMmssTotal('work'),
            rest: getMmssTotal('rest'),
            recover: getMmssTotal('recover'),
            restEnabled: checkboxes.rest.checked,
            recoverEnabled: checkboxes.recover.checked,
            name: activeWorkoutName
        });
    }

    function buildPlaylistSchedule(workoutObjects, transitionSec) {
        const seq = [];
        workoutObjects.forEach((w, i) => {
            if (i > 0 && transitionSec > 0)
                seq.push({ type: 'transition', duration: transitionSec, workoutName: w.name, set: 1, rep: 1, totalSets: w.sets, totalReps: w.reps });
            seq.push(...buildWorkoutSchedule(w));
        });
        return seq;
    }

    // Prepend a 3-second countdown
    function prependCountdown(seq) {
        if (!seq.length) return seq;
        return [
            { type: 'countdown', duration: 1, workoutName: seq[0].workoutName || '', set: seq[0].set, rep: seq[0].rep, totalSets: seq[0].totalSets, totalReps: seq[0].totalReps },
            { type: 'countdown', duration: 1, workoutName: seq[0].workoutName || '', set: seq[0].set, rep: seq[0].rep, totalSets: seq[0].totalSets, totalReps: seq[0].totalReps },
            { type: 'countdown', duration: 1, workoutName: seq[0].workoutName || '', set: seq[0].set, rep: seq[0].rep, totalSets: seq[0].totalSets, totalReps: seq[0].totalReps },
            ...seq
        ];
    }

    function totalSeconds(seq) {
        return seq.reduce((s, step) => s + step.duration, 0);
    }

    function formatDuration(sec) {
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60), s = sec % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }

    function getNextPhaseLabel(index) {
        const next = schedule[index + 1];
        if (!next) return '';
        const name = phaseNames[next.type] || next.type;
        return `Next: ${name} ${formatDuration(next.duration)}`;
    }

    // Playlist workout index tracking
    let playlistWorkoutCount = 0;  // total workouts in playlist
    let playlistWorkoutIndex = 0;  // current (1-based)

    function computePlaylistWorkoutIndex(stepIdx) {
        // Count transitions before or at stepIdx — each transition marks a new workout
        let count = 1;
        for (let i = 0; i < stepIdx; i++) {
            if (schedule[i].type === 'transition') count++;
        }
        return count;
    }

    function setInputsDisabled(disabled) {
        document.querySelectorAll('.stepper button, .stepper input').forEach(el => el.disabled = disabled);
        document.getElementById('set-default').disabled = disabled;
        checkboxes.rest.disabled = disabled;
        checkboxes.recover.disabled = disabled;
    }

    function loadStep(index) {
        const step = schedule[index];
        currentDuration = step.duration;
        timeRemaining = step.duration;
        phaseLabel.textContent = phaseNames[step.type] || step.type;

        if (step.type === 'countdown') {
            const countNum = 3 - (index); // rough — works for prepended steps
            // Actually count from the start of countdown steps
            const countdownSteps = schedule.filter((s,i) => i <= index && s.type === 'countdown');
            const num = 4 - countdownSteps.length;
            phaseLabel.textContent = String(num);
            workoutNameDisplay.textContent = step.workoutName || '';
            setDisplay.textContent = `Set 1 of ${step.totalSets}`;
            repDisplay.textContent = `Rep 1 of ${step.totalReps}`;
            nextPhaseDisplay.textContent = '';
            playlistProgressDisplay.textContent = '';
        } else if (step.type === 'transition') {
            workoutNameDisplay.textContent = 'Next: ' + step.workoutName;
            setDisplay.textContent = `Set 1 of ${step.totalSets}`;
            repDisplay.textContent = `Rep 1 of ${step.totalReps}`;
            nextPhaseDisplay.textContent = '';
            if (playlistWorkoutCount > 1) {
                const wi = computePlaylistWorkoutIndex(index);
                playlistProgressDisplay.textContent = `Workout ${wi} of ${playlistWorkoutCount}`;
            } else { playlistProgressDisplay.textContent = ''; }
        } else {
            workoutNameDisplay.textContent = step.workoutName || activeWorkoutName;
            setDisplay.textContent = `Set ${step.set} of ${step.totalSets}`;
            repDisplay.textContent = `Rep ${step.rep} of ${step.totalReps}`;
            nextPhaseDisplay.textContent = getNextPhaseLabel(index);
            if (playlistWorkoutCount > 1) {
                const wi = computePlaylistWorkoutIndex(index);
                playlistProgressDisplay.textContent = `Workout ${wi} of ${playlistWorkoutCount}`;
            } else { playlistProgressDisplay.textContent = ''; }
        }

        container.style.setProperty('--phase-color', phaseColors[step.type] || '#999');
        progressBar.style.setProperty('--progress', '0%');
        updateTimeDisplay();
    }

    function formatTime(sec) {
        const m = Math.floor(sec / 60), s = sec % 60;
        return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    }

    function updateTimeDisplay() {
        timeDisplay.textContent = formatTime(timeRemaining);
        const progress = ((currentDuration - timeRemaining) / currentDuration) * 100;
        progressBar.style.setProperty('--progress', `${progress}%`);
    }

    function tick() {
        // Countdown beeps at 3, 2, 1 before phase ends
        if (timeRemaining === 3) playCountdownBeep();
        else if (timeRemaining === 2) playCountdownBeep();
        else if (timeRemaining === 1) playFinalBeep();

        timeRemaining--;
        if (timeRemaining < 0) { advanceStep(); return; }
        updateTimeDisplay();
    }

    function advanceStep() {
        stepIndex++;
        if (stepIndex >= schedule.length) { workoutComplete(); return; }
        const step = schedule[stepIndex];
        playPhaseStart(step.type);
        // Voice announcement
        if (step.type === 'work') speak('Work');
        else if (step.type === 'rest') speak('Rest');
        else if (step.type === 'recover') speak('Recover');
        else if (step.type === 'transition') speak('Next: ' + step.workoutName);
        else if (step.type === 'countdown') {
            const cdSteps = schedule.filter((s,i) => i <= stepIndex && s.type === 'countdown');
            speak(String(4 - cdSteps.length));
        }
        loadStep(stepIndex);
    }

    function startTimer(overrideSchedule) {
        if (!isRunning && !isPaused) {
            let seq = overrideSchedule || buildSchedule();
            if (seq.length === 0) return;
            seq = prependCountdown(seq);
            schedule = seq;
            stepIndex = 0;
            loadStep(0);
            setInputsDisabled(true);
            container.classList.add('timer-running');
            requestWakeLock();
            // Speak first countdown number
            speak('3');
            playPhaseStart('countdown');
        }
        isRunning = true;
        isPaused = false;
        startStopBtn.textContent = 'Pause';
        timerInterval = setInterval(tick, 1000);
    }

    function pauseTimer() {
        clearInterval(timerInterval);
        isRunning = false; isPaused = true;
        startStopBtn.textContent = 'Resume';
        releaseWakeLock();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
    }

    function startStopHandler() { if (isRunning) pauseTimer(); else startTimer(); }

    // ── Defaults ──────────────────────────────────────────────────────
    const defaultStorageKey = 'hiitTimerDefaultsV3';
    const hardDefaults = { sets: 2, reps: 2, work: 10, rest: 4, recover: 30, restEnabled: true, recoverEnabled: true };
    let defaults = { ...hardDefaults };

    function loadSavedDefaults() {
        try {
            const saved = localStorage.getItem(defaultStorageKey);
            if (saved) { const p = JSON.parse(saved); Object.keys(defaults).forEach(k => { if (p[k] !== undefined) defaults[k] = p[k]; }); }
        } catch(e) {}
    }
    function saveDefaults() {
        defaults.sets = parseInt(intInputs.sets.value, 10);
        defaults.reps = parseInt(intInputs.reps.value, 10);
        defaults.work = getMmssTotal('work');
        defaults.rest = getMmssTotal('rest');
        defaults.recover = getMmssTotal('recover');
        defaults.restEnabled = checkboxes.rest.checked;
        defaults.recoverEnabled = checkboxes.recover.checked;
        try { localStorage.setItem(defaultStorageKey, JSON.stringify(defaults)); } catch(e) {}
    }
    function applyDefaults() {
        intInputs.sets.value = defaults.sets;
        intInputs.reps.value = defaults.reps;
        setMmssTotal('work', defaults.work);
        setMmssTotal('rest', defaults.rest);
        setMmssTotal('recover', defaults.recover);
        checkboxes.rest.checked = defaults.restEnabled;
        checkboxes.recover.checked = defaults.recoverEnabled;
        applyCheckboxState('rest');
        applyCheckboxState('recover');
    }

    function calcPreviewDuration() {
        const sets = parseInt(intInputs.sets.value, 10);
        const reps = parseInt(intInputs.reps.value, 10);
        const work = getMmssTotal('work');
        const rest = checkboxes.rest.checked ? getMmssTotal('rest') : 0;
        const recover = checkboxes.recover.checked ? getMmssTotal('recover') : 0;
        let total = sets * reps * work;
        if (rest > 0) total += sets * (reps - 1) * rest;
        if (recover > 0) total += (sets - 1) * recover;
        return total;
    }

    function updateCirclePreview() {
        if (isRunning || isPaused) return;
        const work = getMmssTotal('work');
        const totalSets = parseInt(intInputs.sets.value, 10);
        const totalReps = parseInt(intInputs.reps.value, 10);
        timeDisplay.textContent = formatTime(work);
        progressBar.style.setProperty('--progress', '0%');
        setDisplay.textContent = `Set 1 of ${totalSets}`;
        repDisplay.textContent = `Rep 1 of ${totalReps}`;
        nextPhaseDisplay.textContent = '';
        const dur = calcPreviewDuration();
        totalDurationDisplay.textContent = dur > 0 ? `~${formatDuration(dur)}` : '';
    }

    function updateWorkPreview() { updateCirclePreview(); }

    function resetTimer() {
        clearInterval(timerInterval);
        isRunning = false; isPaused = false;
        stepIndex = 0; schedule = [];
        playlistWorkoutCount = 0; playlistWorkoutIndex = 0;
        container.classList.remove('timer-running');
        setInputsDisabled(false);
        startStopBtn.textContent = 'Start';
        applyDefaults();
        activeWorkoutName = '';
        workoutNameDisplay.textContent = '';
        playlistProgressDisplay.textContent = '';
        nextPhaseDisplay.textContent = '';
        phaseLabel.textContent = 'Ready';
        container.style.setProperty('--phase-color', phaseColors.work);
        progressBar.style.setProperty('--progress', '0%');
        progressBar.style.background = '';
        releaseWakeLock();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        updateCirclePreview();
    }

    function workoutComplete() {
        clearInterval(timerInterval);
        isRunning = false; isPaused = false;
        releaseWakeLock();
        speak('Workout complete!');
        const alarmInterval = setInterval(() => playBeep(800, 50), 300);
        setTimeout(() => clearInterval(alarmInterval), 3000);
        let isRed = false, flashCount = 0;
        const flashInterval = setInterval(() => {
            isRed = !isRed;
            progressBar.style.background = isRed ? 'conic-gradient(red 0%, red 100%)' : 'conic-gradient(transparent 0%, transparent 100%)';
            if (++flashCount >= 10) { clearInterval(flashInterval); progressBar.style.background = ''; resetTimer(); }
        }, 500);
    }

    startStopBtn.addEventListener('click', startStopHandler);
    resetBtn.addEventListener('click', resetTimer);

    const setDefaultBtn = document.getElementById('set-default');
    setDefaultBtn.addEventListener('click', () => {
        if (isRunning || isPaused) return;
        saveDefaults();
        const orig = setDefaultBtn.textContent;
        setDefaultBtn.textContent = 'Saved!';
        setTimeout(() => { setDefaultBtn.textContent = orig; }, 1000);
    });

    document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName === 'BUTTON') e.preventDefault(); });

    loadSavedDefaults();
    resetTimer();

    // ── Drawer / Tab ──────────────────────────────────────────────────
    const drawer = document.getElementById('workout-drawer');
    const overlay = document.getElementById('drawer-overlay');
    const openLibraryBtn = document.getElementById('open-library');
    const closeDrawerBtn = document.getElementById('close-drawer');
    const workoutList = document.getElementById('workout-list');
    const workoutNameInput = document.getElementById('workout-name');
    const saveWorkoutBtn = document.getElementById('save-workout');
    const workoutSearchInput = document.getElementById('workout-search');
    const playlistList = document.getElementById('playlist-list');

    let activeTab = 'workouts';

    function openDrawer() {
        drawer.classList.add('open'); overlay.classList.add('open');
        renderActiveTab();
        if (activeTab === 'workouts') workoutNameInput.focus();
    }
    function closeDrawer() {
        drawer.classList.remove('open'); overlay.classList.remove('open');
        closePlaylistEditor();
    }
    function renderActiveTab() {
        if (activeTab === 'workouts') renderWorkoutList(); else renderPlaylistList();
    }

    openLibraryBtn.addEventListener('click', openDrawer);
    closeDrawerBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    workoutSearchInput.addEventListener('input', renderWorkoutList);

    document.querySelectorAll('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            document.querySelectorAll('.drawer-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + activeTab));
            renderActiveTab();
        });
    });

    // ── Storage ───────────────────────────────────────────────────────
    const WORKOUTS_KEY = 'hiitWorkouts', PLAYLISTS_KEY = 'hiitPlaylists';
    function loadWorkouts()  { try { return JSON.parse(localStorage.getItem(WORKOUTS_KEY)  || '[]'); } catch(e) { return []; } }
    function saveWorkouts(w) { localStorage.setItem(WORKOUTS_KEY,  JSON.stringify(w)); }
    function loadPlaylists() { try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); } catch(e) { return []; } }
    function savePlaylists(p){ localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(p)); }

    // ── Workout helpers ───────────────────────────────────────────────
    function getCurrentSettings() {
        return { sets: parseInt(intInputs.sets.value,10), reps: parseInt(intInputs.reps.value,10),
                 work: getMmssTotal('work'), rest: getMmssTotal('rest'), recover: getMmssTotal('recover'),
                 restEnabled: checkboxes.rest.checked, recoverEnabled: checkboxes.recover.checked };
    }
    function applySettings(s) {
        intInputs.sets.value = s.sets; intInputs.reps.value = s.reps;
        setMmssTotal('work', s.work); setMmssTotal('rest', s.rest ?? 4); setMmssTotal('recover', s.recover ?? 30);
        checkboxes.rest.checked = s.restEnabled ?? true; checkboxes.recover.checked = s.recoverEnabled ?? true;
        applyCheckboxState('rest'); applyCheckboxState('recover');
        updateCirclePreview();
    }
    function formatSummary(s) {
        const fmt = sec => { const m=Math.floor(sec/60),ss=sec%60; return m>0?`${m}m${ss>0?ss+'s':''}`:`${ss}s`; };
        const parts = [`${s.sets}×${s.reps}`, `Work ${fmt(s.work)}`];
        if (s.restEnabled && s.rest>0) parts.push(`Rest ${fmt(s.rest)}`);
        if (s.recoverEnabled && s.recover>0) parts.push(`Recover ${fmt(s.recover)}`);
        return parts.join(' · ');
    }
    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Workout list ──────────────────────────────────────────────────
    function renderWorkoutList() {
        const workouts = loadWorkouts();
        const query = workoutSearchInput.value.trim().toLowerCase();
        const filtered = query ? workouts.filter(w => w.name.toLowerCase().includes(query)) : workouts;
        const isFiltered = !!query;

        if (filtered.length === 0) {
            workoutList.innerHTML = `<div class="workout-empty">${query ? 'No workouts match.' : 'No saved workouts yet.<br>Set up a workout and hit Save!'}</div>`;
            return;
        }
        workoutList.innerHTML = filtered.map(w => {
            const ri = workouts.indexOf(w);
            return `<div class="workout-item" data-index="${ri}" draggable="${!isFiltered}">
                <div class="drag-handle ${isFiltered?'drag-handle-hidden':''}" title="Drag to reorder">⠿</div>
                <div class="workout-item-info" title="Load ${escHtml(w.name)}">
                    <div class="workout-item-name">${escHtml(w.name)}</div>
                    <div class="workout-item-detail">${escHtml(formatSummary(w))}</div>
                </div>
                <div class="workout-item-actions">
                    <button class="workout-action-btn load-btn" data-index="${ri}" title="Load">▶</button>
                    <button class="workout-action-btn copy-btn" data-index="${ri}" title="Copy">⧉</button>
                    <button class="workout-action-btn rename-btn" data-index="${ri}" title="Rename">✏️</button>
                    <button class="workout-action-btn delete delete-btn" data-index="${ri}" title="Delete">🗑️</button>
                </div>
            </div>`;
        }).join('');

        workoutList.querySelectorAll('.workout-item-info').forEach(el =>
            el.addEventListener('click', () => loadWorkout(parseInt(el.closest('.workout-item').dataset.index,10))));
        workoutList.querySelectorAll('.load-btn').forEach(btn => btn.addEventListener('click', () => loadWorkout(parseInt(btn.dataset.index,10))));
        workoutList.querySelectorAll('.copy-btn').forEach(btn => btn.addEventListener('click', () => copyWorkout(parseInt(btn.dataset.index,10))));
        workoutList.querySelectorAll('.rename-btn').forEach(btn => btn.addEventListener('click', () => startRename(parseInt(btn.dataset.index,10))));
        workoutList.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteWorkout(parseInt(btn.dataset.index,10))));
        if (!isFiltered) initDragAndDrop(workoutList, (from, to) => {
            const w = loadWorkouts(); const [m] = w.splice(from,1); w.splice(to,0,m); saveWorkouts(w); renderWorkoutList();
        });
    }

    saveWorkoutBtn.addEventListener('click', () => {
        const name = workoutNameInput.value.trim();
        if (!name) { workoutNameInput.focus(); return; }
        const w = loadWorkouts(); w.unshift({ name, ...getCurrentSettings(), savedAt: Date.now() });
        saveWorkouts(w); workoutNameInput.value = ''; renderWorkoutList();
    });

    function loadWorkout(index) {
        const w = loadWorkouts(); if (!w[index]) return;
        applySettings(w[index]);
        activeWorkoutName = w[index].name;
        workoutNameDisplay.textContent = activeWorkoutName;
        closeDrawer();
    }
    function copyWorkout(index) {
        const w = loadWorkouts(); if (!w[index]) return;
        w.splice(index+1, 0, { ...w[index], savedAt: Date.now() });
        saveWorkouts(w); renderWorkoutList();
    }
    function deleteWorkout(index) {
        const w = loadWorkouts(); if (!w[index]) return;
        if (!confirm(`Delete "${w[index].name}"?`)) return;
        w.splice(index,1); saveWorkouts(w); renderWorkoutList();
    }
    function startRename(index) {
        const w = loadWorkouts(); if (!w[index]) return;
        const item = workoutList.querySelector(`.workout-item[data-index="${index}"]`); if (!item) return;
        const nameDiv = item.querySelector('.workout-item-name');
        const actionsDiv = item.querySelector('.workout-item-actions');
        nameDiv.innerHTML = `<input class="workout-rename-input" value="${escHtml(w[index].name)}" maxlength="40">`;
        actionsDiv.innerHTML = `<button class="workout-action-btn rename-confirm-btn" title="Save">✓</button>
                                <button class="workout-action-btn rename-cancel-btn" title="Cancel">✕</button>`;
        const input = nameDiv.querySelector('input');
        const confirmBtn = actionsDiv.querySelector('.rename-confirm-btn');
        const cancelBtn  = actionsDiv.querySelector('.rename-cancel-btn');
        input.focus(); input.setSelectionRange(input.value.length, input.value.length);
        function commit() { const n=input.value.trim(); if(n) w[index].name=n; saveWorkouts(w); renderWorkoutList(); }
        confirmBtn.addEventListener('click', commit);
        cancelBtn.addEventListener('click', () => renderWorkoutList());
        input.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape') renderWorkoutList(); });
    }

    // ── Export / Import (workouts) ────────────────────────────────────
    document.getElementById('export-workouts').addEventListener('click', () => {
        const w = loadWorkouts(); if (!w.length) { alert('No saved workouts to export.'); return; }
        download(JSON.stringify(w,null,2), 'hiit-workouts.json');
    });
    document.getElementById('import-workouts').addEventListener('change', e => {
        importJson(e, data => {
            const valid = data.filter(w => w && typeof w.name==='string');
            if (!valid.length) throw new Error('No valid workouts found');
            saveWorkouts([...loadWorkouts(), ...valid]); renderWorkoutList();
            alert(`Imported ${valid.length} workout(s).`);
        });
    });

    // ── Playlist list ─────────────────────────────────────────────────
    function renderPlaylistList() {
        const playlists = loadPlaylists();
        if (!playlists.length) {
            playlistList.innerHTML = `<div class="workout-empty">No playlists yet.<br>Enter a name above and tap New.</div>`;
            return;
        }
        playlistList.innerHTML = playlists.map((p,i) => {
            const count = (p.workoutNames||[]).length;
            return `<div class="workout-item" data-index="${i}">
                <div class="workout-item-info">
                    <div class="workout-item-name">${escHtml(p.name)}</div>
                    <div class="workout-item-detail">${count} workout${count!==1?'s':''}</div>
                </div>
                <div class="workout-item-actions">
                    <button class="workout-action-btn play-playlist-btn" data-index="${i}" title="Play">▶</button>
                    <button class="workout-action-btn edit-playlist-btn" data-index="${i}" title="Edit">✏️</button>
                    <button class="workout-action-btn delete delete-playlist-btn" data-index="${i}" title="Delete">🗑️</button>
                </div>
            </div>`;
        }).join('');

        playlistList.querySelectorAll('.play-playlist-btn').forEach(btn => btn.addEventListener('click', () => playPlaylist(parseInt(btn.dataset.index,10))));
        playlistList.querySelectorAll('.edit-playlist-btn').forEach(btn => btn.addEventListener('click', () => openPlaylistEditor(parseInt(btn.dataset.index,10))));
        playlistList.querySelectorAll('.delete-playlist-btn').forEach(btn => btn.addEventListener('click', () => deletePlaylist(parseInt(btn.dataset.index,10))));
    }

    document.getElementById('save-playlist').addEventListener('click', () => {
        const name = document.getElementById('playlist-name').value.trim();
        if (!name) { document.getElementById('playlist-name').focus(); return; }
        const p = loadPlaylists(); p.push({ name, workoutNames: [], transitionSec: 5 });
        savePlaylists(p); document.getElementById('playlist-name').value = '';
        renderPlaylistList(); openPlaylistEditor(p.length-1);
    });

    function deletePlaylist(index) {
        const p = loadPlaylists(); if (!p[index]) return;
        if (!confirm(`Delete playlist "${p[index].name}"?`)) return;
        p.splice(index,1); savePlaylists(p); renderPlaylistList();
    }

    function playPlaylist(index) {
        const playlists = loadPlaylists();
        const playlist = playlists[index];
        if (!playlist || !playlist.workoutNames.length) { alert('This playlist has no workouts. Edit it to add some.'); return; }
        const allWorkouts = loadWorkouts();
        const workoutObjects = playlist.workoutNames.map(name => allWorkouts.find(w => w.name===name)).filter(Boolean);
        if (!workoutObjects.length) { alert('None of the workouts in this playlist exist anymore.'); return; }
        const transitionSec = playlist.transitionSec ?? 5;
        const seq = buildPlaylistSchedule(workoutObjects, transitionSec);
        playlistWorkoutCount = workoutObjects.length;
        activeWorkoutName = playlist.name;
        workoutNameDisplay.textContent = playlist.name;
        closeDrawer();
        startTimer(seq);
    }

    // ── Export / Import (playlists) ───────────────────────────────────
    document.getElementById('export-playlists').addEventListener('click', () => {
        const p = loadPlaylists(); if (!p.length) { alert('No saved playlists to export.'); return; }
        download(JSON.stringify(p,null,2), 'hiit-playlists.json');
    });
    document.getElementById('import-playlists').addEventListener('change', e => {
        importJson(e, data => {
            const valid = data.filter(p => p && typeof p.name==='string' && Array.isArray(p.workoutNames));
            if (!valid.length) throw new Error('No valid playlists found');
            savePlaylists([...loadPlaylists(), ...valid]); renderPlaylistList();
            alert(`Imported ${valid.length} playlist(s).`);
        });
    });

    // ── Playlist editor ───────────────────────────────────────────────
    const playlistEditor = document.getElementById('playlist-editor');
    const playlistEditorOverlay = document.getElementById('playlist-editor-overlay');
    const playlistEditorTitle = document.getElementById('playlist-editor-title');
    const playlistWorkoutSearch = document.getElementById('playlist-workout-search');
    const playlistPool = document.getElementById('playlist-workout-pool');
    const playlistEntries = document.getElementById('playlist-entries');
    const transitionMinInput = document.getElementById('transition-min');
    const transitionSecInput = document.getElementById('transition-sec');

    let editingPlaylistIndex = -1;

    // Transition stepper buttons inside editor
    document.querySelectorAll('.stepper button[data-target="transition-min"], .stepper button[data-target="transition-sec"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const part = btn.dataset.target === 'transition-min' ? 'min' : 'sec';
            const isUp = btn.classList.contains('step-up');
            let mins = parseInt(transitionMinInput.value, 10);
            let secs = parseInt(transitionSecInput.value, 10);
            let total = mins * 60 + secs;
            total += isUp ? (part === 'min' ? 60 : 1) : (part === 'min' ? -60 : -1);
            total = Math.max(0, Math.min(3600, total));
            transitionMinInput.value = Math.floor(total / 60);
            transitionSecInput.value = total % 60;
            // Save to playlist
            if (editingPlaylistIndex >= 0) {
                const p = loadPlaylists();
                p[editingPlaylistIndex].transitionSec = total;
                savePlaylists(p);
            }
        });
    });

    function openPlaylistEditor(index) {
        editingPlaylistIndex = index;
        const p = loadPlaylists();
        playlistEditorTitle.textContent = p[index].name;
        const ts = p[index].transitionSec ?? 5;
        transitionMinInput.value = Math.floor(ts / 60);
        transitionSecInput.value = ts % 60;
        playlistEditor.classList.add('open');
        playlistEditorOverlay.classList.add('open');
        playlistWorkoutSearch.value = '';
        renderPlaylistEditor();
    }
    function closePlaylistEditor() {
        playlistEditor.classList.remove('open');
        playlistEditorOverlay.classList.remove('open');
        editingPlaylistIndex = -1;
    }

    document.getElementById('playlist-editor-back').addEventListener('click', () => { closePlaylistEditor(); renderPlaylistList(); });
    document.getElementById('playlist-editor-close').addEventListener('click', () => { closePlaylistEditor(); closeDrawer(); });
    playlistEditorOverlay.addEventListener('click', closePlaylistEditor);
    playlistWorkoutSearch.addEventListener('input', renderPlaylistEditor);

    function renderPlaylistEditor() {
        if (editingPlaylistIndex < 0) return;
        const playlists = loadPlaylists();
        const playlist = playlists[editingPlaylistIndex];
        if (!playlist) return;
        const allWorkouts = loadWorkouts();
        const query = playlistWorkoutSearch.value.trim().toLowerCase();
        const filtered = query ? allWorkouts.filter(w => w.name.toLowerCase().includes(query)) : allWorkouts;

        if (!filtered.length) {
            playlistPool.innerHTML = `<div class="workout-empty">No workouts found.</div>`;
        } else {
            playlistPool.innerHTML = filtered.map(w => `
                <div class="workout-item pool-item">
                    <div class="workout-item-info">
                        <div class="workout-item-name">${escHtml(w.name)}</div>
                        <div class="workout-item-detail">${escHtml(formatSummary(w))}</div>
                    </div>
                    <div class="workout-item-actions">
                        <button class="workout-action-btn pool-add-btn" data-name="${escHtml(w.name)}" title="Add to playlist">+</button>
                    </div>
                </div>`).join('');
            playlistPool.querySelectorAll('.pool-add-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = loadPlaylists(); p[editingPlaylistIndex].workoutNames.push(btn.dataset.name);
                    savePlaylists(p); renderPlaylistEditor();
                });
            });
        }

        if (!playlist.workoutNames.length) {
            playlistEntries.innerHTML = `<div class="workout-empty">Tap + to add workouts above.</div>`;
        } else {
            playlistEntries.innerHTML = playlist.workoutNames.map((name, i) => `
                <div class="workout-item" data-index="${i}" draggable="true">
                    <div class="drag-handle" title="Drag to reorder">⠿</div>
                    <div class="workout-item-info"><div class="workout-item-name">${escHtml(name)}</div></div>
                    <div class="workout-item-actions">
                        <button class="workout-action-btn delete entry-remove-btn" data-index="${i}" title="Remove">✕</button>
                    </div>
                </div>`).join('');
            playlistEntries.querySelectorAll('.entry-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = loadPlaylists(); p[editingPlaylistIndex].workoutNames.splice(parseInt(btn.dataset.index,10),1);
                    savePlaylists(p); renderPlaylistEditor();
                });
            });
            initDragAndDrop(playlistEntries, (from, to) => {
                const p = loadPlaylists(); const names = p[editingPlaylistIndex].workoutNames;
                const [m] = names.splice(from,1); names.splice(to,0,m); savePlaylists(p); renderPlaylistEditor();
            });
        }
    }

    // ── Shared drag-and-drop ──────────────────────────────────────────
    function initDragAndDrop(listEl, onReorder) {
        const items = [...listEl.querySelectorAll('.workout-item[draggable="true"]')];
        if (items.length < 2) return;
        let dragSrc=null, dragGhost=null, offsetY=0, active=false;

        function getItemAtY(y) { return items.find(item => { const r=item.getBoundingClientRect(); return y>=r.top && y<=r.bottom; }) || null; }
        function cleanup() {
            active=false; items.forEach(i=>i.classList.remove('drag-over','dragging'));
            if(dragGhost){dragGhost.remove();dragGhost=null;} dragSrc=null;
        }

        items.forEach(item => {
            const handle = item.querySelector('.drag-handle'); if (!handle) return;
            handle.addEventListener('pointerdown', e => {
                e.preventDefault(); e.stopPropagation();
                active=true; dragSrc=item;
                const rect=item.getBoundingClientRect(); offsetY=e.clientY-rect.top;
                dragGhost=item.cloneNode(true);
                dragGhost.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.75;pointer-events:none;z-index:9999;background:white;border:2px solid #4ecdc4;border-radius:4px;box-sizing:border-box;`;
                document.body.appendChild(dragGhost); item.classList.add('dragging');
            });
        });

        document.addEventListener('pointermove', e => {
            if (!active||!dragSrc) return; e.preventDefault();
            dragGhost.style.top=(e.clientY-offsetY)+'px';
            const target=getItemAtY(e.clientY);
            items.forEach(i=>i.classList.remove('drag-over'));
            if(target&&target!==dragSrc) target.classList.add('drag-over');
        }, {passive:false});

        document.addEventListener('pointerup', e => {
            if (!active||!dragSrc) return;
            const target=getItemAtY(e.clientY);
            if(target&&target!==dragSrc) onReorder(parseInt(dragSrc.dataset.index,10), parseInt(target.dataset.index,10));
            else cleanup();
        });

        document.addEventListener('pointercancel', () => { if(active) cleanup(); });
    }

    // ── Shared file helpers ───────────────────────────────────────────
    function download(json, filename) {
        const url = URL.createObjectURL(new Blob([json], {type:'application/json'}));
        const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
        URL.revokeObjectURL(url);
    }
    function importJson(e, onData) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const data = JSON.parse(event.target.result);
                if (!Array.isArray(data)) throw new Error('Invalid format');
                onData(data);
            } catch(err) { alert('Import failed: ' + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

});
