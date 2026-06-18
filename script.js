document.addEventListener('DOMContentLoaded', function() {
    const timeDisplay = document.querySelector('.time');
    const phaseLabel = document.querySelector('.phase-label');
    const setDisplay = document.querySelector('.set-display');
    const repDisplay = document.querySelector('.rep-display');
    const workoutNameDisplay = document.querySelector('.workout-name-display');

    let activeWorkoutName = '';
    const startStopBtn = document.getElementById('start-stop');
    const resetBtn = document.getElementById('reset');
    const container = document.querySelector('.container');
    const progressBar = document.querySelector('.progress-bar');

    const intInputs = {
        sets: document.getElementById('sets'),
        reps: document.getElementById('reps')
    };
    const intLimits = {
        sets: { min: 1, max: 10 },
        reps: { min: 1, max: 20 }
    };

    const mmssFields = ['work', 'rest', 'recover'];
    const mmssInputs = {};
    mmssFields.forEach(f => {
        mmssInputs[f] = {
            min: document.getElementById(f + '-min'),
            sec: document.getElementById(f + '-sec')
        };
    });

    const mmssMinTotal = { work: 1, rest: 0, recover: 0 };
    const mmssMaxTotal = 3600;

    const checkboxes = {
        rest: document.getElementById('rest-enabled'),
        recover: document.getElementById('recover-enabled')
    };
    const stepperDivs = {
        rest: document.getElementById('rest-stepper'),
        recover: document.getElementById('recover-stepper')
    };

    function getMmssTotal(field) {
        return parseInt(mmssInputs[field].min.value, 10) * 60
             + parseInt(mmssInputs[field].sec.value, 10);
    }

    function setMmssTotal(field, totalSec) {
        totalSec = Math.max(mmssMinTotal[field], Math.min(mmssMaxTotal, totalSec));
        mmssInputs[field].min.value = Math.floor(totalSec / 60);
        mmssInputs[field].sec.value = totalSec % 60;
    }

    function applyCheckboxState(field) {
        const enabled = checkboxes[field].checked;
        stepperDivs[field].style.display = enabled ? '' : 'none';
    }

    ['rest', 'recover'].forEach(field => {
        checkboxes[field].addEventListener('change', () => {
            if (isRunning || isPaused) return;
            applyCheckboxState(field);
        });
        applyCheckboxState(field);
    });

    const phaseColors = {
        work: '#4caf50',
        rest: '#ffd166',
        recover: '#42a5f5',
        transition: '#b39ddb'
    };
    const phaseNames = {
        work: 'Work',
        rest: 'Rest',
        recover: 'Recover',
        transition: 'Get Ready'
    };

    // Stepper buttons
    document.querySelectorAll('.stepper button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning || isPaused) return;
            const target = btn.dataset.target;
            const isUp = btn.classList.contains('step-up');

            const mmssMatch = target.match(/^(work|rest|recover)-(min|sec)$/);
            if (mmssMatch) {
                const field = mmssMatch[1];
                const part = mmssMatch[2];
                let total = getMmssTotal(field);
                total += isUp ? (part === 'min' ? 60 : 1)
                              : (part === 'min' ? -60 : -1);
                setMmssTotal(field, total);
                if (field === 'work') updateWorkPreview();
                return;
            }

            const input = intInputs[target];
            const { min, max } = intLimits[target];
            let value = parseInt(input.value, 10);
            value = isUp ? Math.min(max, value + 1) : Math.max(min, value - 1);
            input.value = value;
            updateCirclePreview();
        });
    });

    // Audio
    let audioContext, audioInitialized = false;

    function initAudio() {
        if (audioInitialized) return;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioInitialized = true;
        } catch(e) { console.error('Audio init error:', e); }
    }

    function playBeep(type = 'sine', frequency = 800, duration = 200) {
        if (!audioInitialized) { initAudio(); if (!audioInitialized) return; }
        try {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            osc.connect(gain);
            gain.connect(audioContext.destination);
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.01);
            gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
            osc.start();
            osc.stop(audioContext.currentTime + duration / 1000);
        } catch(e) { console.error('Beep error:', e); }
    }

    function initAudioOnInteraction() {
        if (audioContext?.state === 'suspended') audioContext.resume();
        else if (!audioInitialized) initAudio();
    }
    document.addEventListener('click', initAudioOnInteraction, { once: true });
    document.addEventListener('keydown', initAudioOnInteraction, { once: true });
    initAudio();

    // Timer state
    let isRunning = false, isPaused = false;
    let timerInterval;
    let schedule = [], stepIndex = 0, timeRemaining = 0, currentDuration = 0;

    function buildWorkoutSchedule(w) {
        // Build phase sequence for a single saved workout object
        const sets = w.sets;
        const reps = w.reps;
        const work = w.work;
        const rest = w.restEnabled ? (w.rest ?? 0) : 0;
        const recover = w.recoverEnabled ? (w.recover ?? 0) : 0;
        const seq = [];
        for (let s = 1; s <= sets; s++) {
            for (let r = 1; r <= reps; r++) {
                seq.push({ type: 'work', set: s, rep: r, totalSets: sets, totalReps: reps, workoutName: w.name || '' });
                if (r < reps && rest > 0) {
                    seq.push({ type: 'rest', set: s, rep: r, totalSets: sets, totalReps: reps, workoutName: w.name || '', duration: rest });
                }
            }
            if (s < sets && recover > 0) {
                seq.push({ type: 'recover', set: s, rep: reps, totalSets: sets, totalReps: reps, workoutName: w.name || '', duration: recover });
            }
        }
        // Annotate work/rest/recover duration
        seq.forEach(step => { if (!step.duration) step.duration = work; });
        return seq;
    }

    function buildSchedule() {
        const w = {
            sets: parseInt(intInputs.sets.value, 10),
            reps: parseInt(intInputs.reps.value, 10),
            work: getMmssTotal('work'),
            rest: getMmssTotal('rest'),
            recover: getMmssTotal('recover'),
            restEnabled: checkboxes.rest.checked,
            recoverEnabled: checkboxes.recover.checked,
            name: activeWorkoutName
        };
        return buildWorkoutSchedule(w);
    }

    function buildPlaylistSchedule(workoutObjects, transitionSec) {
        const seq = [];
        workoutObjects.forEach((w, i) => {
            if (i > 0 && transitionSec > 0) {
                seq.push({ type: 'transition', duration: transitionSec, workoutName: w.name, set: 1, rep: 1, totalSets: w.sets, totalReps: w.reps });
            }
            seq.push(...buildWorkoutSchedule(w));
        });
        return seq;
    }

    function setInputsDisabled(disabled) {
        document.querySelectorAll('.stepper button, .stepper input').forEach(el => {
            el.disabled = disabled;
        });
        document.getElementById('set-default').disabled = disabled;
        checkboxes.rest.disabled = disabled;
        checkboxes.recover.disabled = disabled;
    }

    function loadStep(index) {
        const step = schedule[index];
        currentDuration = step.duration;
        timeRemaining = step.duration;
        phaseLabel.textContent = phaseNames[step.type] || step.type;
        if (step.type === 'transition') {
            workoutNameDisplay.textContent = 'Next: ' + step.workoutName;
            setDisplay.textContent = `Set 1 of ${step.totalSets}`;
            repDisplay.textContent = `Rep 1 of ${step.totalReps}`;
        } else {
            workoutNameDisplay.textContent = step.workoutName || activeWorkoutName;
            setDisplay.textContent = `Set ${step.set} of ${step.totalSets}`;
            repDisplay.textContent = `Rep ${step.rep} of ${step.totalReps}`;
        }
        container.style.setProperty('--phase-color', phaseColors[step.type] || '#999');
        progressBar.style.setProperty('--progress', '0%');
        updateTimeDisplay();
    }

    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        timeDisplay.textContent = formatTime(timeRemaining);
        const progress = ((currentDuration - timeRemaining) / currentDuration) * 100;
        progressBar.style.setProperty('--progress', `${progress}%`);
    }

    function tick() {
        timeRemaining--;
        if (timeRemaining < 0) { advanceStep(); return; }
        updateTimeDisplay();
    }

    function advanceStep() {
        playBeep('sine', 800, 50);
        stepIndex++;
        if (stepIndex >= schedule.length) { workoutComplete(); return; }
        loadStep(stepIndex);
    }

    function startTimer(overrideSchedule) {
        if (!isRunning && !isPaused) {
            schedule = overrideSchedule || buildSchedule();
            if (schedule.length === 0) return;
            stepIndex = 0;
            loadStep(0);
            setInputsDisabled(true);
            container.classList.add('timer-running');
        }
        isRunning = true;
        isPaused = false;
        startStopBtn.textContent = 'Pause';
        playBeep('sine', 800, 50);
        timerInterval = setInterval(tick, 1000);
    }

    function pauseTimer() {
        clearInterval(timerInterval);
        isRunning = false;
        isPaused = true;
        startStopBtn.textContent = 'Resume';
    }

    function startStopHandler() {
        if (isRunning) pauseTimer(); else startTimer();
    }

    // Defaults
    const defaultStorageKey = 'hiitTimerDefaultsV3';
    const hardDefaults = { sets: 2, reps: 2, work: 10, rest: 4, recover: 30, restEnabled: true, recoverEnabled: true };
    let defaults = { ...hardDefaults };

    function loadSavedDefaults() {
        try {
            const saved = localStorage.getItem(defaultStorageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(defaults).forEach(k => {
                    if (parsed[k] !== undefined) defaults[k] = parsed[k];
                });
            }
        } catch(e) { console.error('Load defaults error:', e); }
    }

    function saveDefaults() {
        defaults.sets = parseInt(intInputs.sets.value, 10);
        defaults.reps = parseInt(intInputs.reps.value, 10);
        defaults.work = getMmssTotal('work');
        defaults.rest = getMmssTotal('rest');
        defaults.recover = getMmssTotal('recover');
        defaults.restEnabled = checkboxes.rest.checked;
        defaults.recoverEnabled = checkboxes.recover.checked;
        try {
            localStorage.setItem(defaultStorageKey, JSON.stringify(defaults));
        } catch(e) { console.error('Save defaults error:', e); }
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

    function updateCirclePreview() {
        if (!isRunning && !isPaused) {
            currentDuration = getMmssTotal('work');
            timeRemaining = currentDuration;
            timeDisplay.textContent = formatTime(timeRemaining);
            progressBar.style.setProperty('--progress', '0%');
            const totalSets = parseInt(intInputs.sets.value, 10);
            const totalReps = parseInt(intInputs.reps.value, 10);
            setDisplay.textContent = `Set 1 of ${totalSets}`;
            repDisplay.textContent = `Rep 1 of ${totalReps}`;
        }
    }

    function updateWorkPreview() { updateCirclePreview(); }

    function resetTimer() {
        clearInterval(timerInterval);
        isRunning = false;
        isPaused = false;
        stepIndex = 0;
        schedule = [];
        container.classList.remove('timer-running');
        setInputsDisabled(false);
        startStopBtn.textContent = 'Start';
        applyDefaults();
        activeWorkoutName = '';
        workoutNameDisplay.textContent = '';
        phaseLabel.textContent = 'Ready';
        container.style.setProperty('--phase-color', phaseColors.work);
        progressBar.style.setProperty('--progress', '0%');
        progressBar.style.background = '';
        updateCirclePreview();
    }

    function workoutComplete() {
        clearInterval(timerInterval);
        isRunning = false;
        isPaused = false;
        const alarmInterval = setInterval(() => playBeep('sine', 800, 50), 300);
        setTimeout(() => clearInterval(alarmInterval), 3000);

        let isRed = false, flashCount = 0;
        const flashInterval = setInterval(() => {
            isRed = !isRed;
            progressBar.style.background = isRed
                ? 'conic-gradient(red 0%, red 100%)'
                : 'conic-gradient(transparent 0%, transparent 100%)';
            flashCount++;
            if (flashCount >= 10) {
                clearInterval(flashInterval);
                progressBar.style.background = '';
                resetTimer();
            }
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

    document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && e.target.tagName === 'BUTTON') e.preventDefault();
    });

    loadSavedDefaults();
    resetTimer();

    // ── Drawer / Tab infrastructure ───────────────────────────────────

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
        drawer.classList.add('open');
        overlay.classList.add('open');
        renderActiveTab();
        if (activeTab === 'workouts') workoutNameInput.focus();
    }

    function closeDrawer() {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        closePlaylistEditor();
    }

    function renderActiveTab() {
        if (activeTab === 'workouts') renderWorkoutList();
        else renderPlaylistList();
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

    // ── Storage helpers ───────────────────────────────────────────────

    const WORKOUTS_KEY = 'hiitWorkouts';
    const PLAYLISTS_KEY = 'hiitPlaylists';

    function loadWorkouts() {
        try { return JSON.parse(localStorage.getItem(WORKOUTS_KEY) || '[]'); } catch(e) { return []; }
    }
    function saveWorkouts(w) { localStorage.setItem(WORKOUTS_KEY, JSON.stringify(w)); }

    function loadPlaylists() {
        try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); } catch(e) { return []; }
    }
    function savePlaylists(p) { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(p)); }

    // ── Workout helpers ───────────────────────────────────────────────

    function getCurrentSettings() {
        return {
            sets: parseInt(intInputs.sets.value, 10),
            reps: parseInt(intInputs.reps.value, 10),
            work: getMmssTotal('work'),
            rest: getMmssTotal('rest'),
            recover: getMmssTotal('recover'),
            restEnabled: checkboxes.rest.checked,
            recoverEnabled: checkboxes.recover.checked
        };
    }

    function applySettings(s) {
        intInputs.sets.value = s.sets;
        intInputs.reps.value = s.reps;
        setMmssTotal('work', s.work);
        setMmssTotal('rest', s.rest ?? 4);
        setMmssTotal('recover', s.recover ?? 30);
        checkboxes.rest.checked = s.restEnabled ?? true;
        checkboxes.recover.checked = s.recoverEnabled ?? true;
        applyCheckboxState('rest');
        applyCheckboxState('recover');
        updateCirclePreview();
    }

    function formatSummary(s) {
        const fmt = sec => {
            const m = Math.floor(sec / 60), ss = sec % 60;
            return m > 0 ? `${m}m${ss > 0 ? ss + 's' : ''}` : `${ss}s`;
        };
        const parts = [`${s.sets}×${s.reps}`, `Work ${fmt(s.work)}`];
        if (s.restEnabled && s.rest > 0) parts.push(`Rest ${fmt(s.rest)}`);
        if (s.recoverEnabled && s.recover > 0) parts.push(`Recover ${fmt(s.recover)}`);
        return parts.join(' · ');
    }

    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Workout list rendering ────────────────────────────────────────

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
            const realIndex = workouts.indexOf(w);
            return `
            <div class="workout-item" data-index="${realIndex}" draggable="${!isFiltered}">
                <div class="drag-handle ${isFiltered ? 'drag-handle-hidden' : ''}" title="Drag to reorder">⠿</div>
                <div class="workout-item-info" title="Load ${escHtml(w.name)}">
                    <div class="workout-item-name">${escHtml(w.name)}</div>
                    <div class="workout-item-detail">${escHtml(formatSummary(w))}</div>
                </div>
                <div class="workout-item-actions">
                    <button class="workout-action-btn load-btn" data-index="${realIndex}" title="Load">▶</button>
                    <button class="workout-action-btn copy-btn" data-index="${realIndex}" title="Copy">⧉</button>
                    <button class="workout-action-btn rename-btn" data-index="${realIndex}" title="Rename">✏️</button>
                    <button class="workout-action-btn delete delete-btn" data-index="${realIndex}" title="Delete">🗑️</button>
                </div>
            </div>`;
        }).join('');

        workoutList.querySelectorAll('.workout-item-info').forEach(el => {
            el.addEventListener('click', () => loadWorkout(parseInt(el.closest('.workout-item').dataset.index, 10)));
        });
        workoutList.querySelectorAll('.load-btn').forEach(btn => {
            btn.addEventListener('click', () => loadWorkout(parseInt(btn.dataset.index, 10)));
        });
        workoutList.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => copyWorkout(parseInt(btn.dataset.index, 10)));
        });
        workoutList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', () => startRename(parseInt(btn.dataset.index, 10)));
        });
        workoutList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteWorkout(parseInt(btn.dataset.index, 10)));
        });

        if (!isFiltered) initDragAndDrop(workoutList, (fromIndex, toIndex) => {
            const workouts = loadWorkouts();
            const [moved] = workouts.splice(fromIndex, 1);
            workouts.splice(toIndex, 0, moved);
            saveWorkouts(workouts);
            renderWorkoutList();
        });
    }

    saveWorkoutBtn.addEventListener('click', () => {
        const name = workoutNameInput.value.trim();
        if (!name) { workoutNameInput.focus(); return; }
        const workouts = loadWorkouts();
        workouts.unshift({ name, ...getCurrentSettings(), savedAt: Date.now() });
        saveWorkouts(workouts);
        workoutNameInput.value = '';
        renderWorkoutList();
    });

    function loadWorkout(index) {
        const workouts = loadWorkouts();
        if (!workouts[index]) return;
        applySettings(workouts[index]);
        activeWorkoutName = workouts[index].name;
        workoutNameDisplay.textContent = activeWorkoutName;
        closeDrawer();
    }

    function copyWorkout(index) {
        const workouts = loadWorkouts();
        if (!workouts[index]) return;
        const copy = { ...workouts[index], savedAt: Date.now() };
        workouts.splice(index + 1, 0, copy);
        saveWorkouts(workouts);
        renderWorkoutList();
    }

    function deleteWorkout(index) {
        const workouts = loadWorkouts();
        if (!workouts[index]) return;
        if (!confirm(`Delete "${workouts[index].name}"?`)) return;
        workouts.splice(index, 1);
        saveWorkouts(workouts);
        renderWorkoutList();
    }

    function startRename(index) {
        const workouts = loadWorkouts();
        if (!workouts[index]) return;
        const item = workoutList.querySelector(`.workout-item[data-index="${index}"]`);
        if (!item) return;
        const nameDiv = item.querySelector('.workout-item-name');
        const actionsDiv = item.querySelector('.workout-item-actions');
        nameDiv.innerHTML = `<input class="workout-rename-input" value="${escHtml(workouts[index].name)}" maxlength="40">`;
        actionsDiv.innerHTML = `
            <button class="workout-action-btn rename-confirm-btn" title="Save">✓</button>
            <button class="workout-action-btn rename-cancel-btn" title="Cancel">✕</button>`;
        const input = nameDiv.querySelector('input');
        const confirmBtn = actionsDiv.querySelector('.rename-confirm-btn');
        const cancelBtn = actionsDiv.querySelector('.rename-cancel-btn');
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
        function commitRename() {
            const newName = input.value.trim();
            if (newName) workouts[index].name = newName;
            saveWorkouts(workouts);
            renderWorkoutList();
        }
        confirmBtn.addEventListener('click', commitRename);
        cancelBtn.addEventListener('click', () => renderWorkoutList());
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { renderWorkoutList(); }
        });
    }

    // ── Export / Import ───────────────────────────────────────────────

    document.getElementById('export-workouts').addEventListener('click', () => {
        const workouts = loadWorkouts();
        if (workouts.length === 0) { alert('No saved workouts to export.'); return; }
        const blob = new Blob([JSON.stringify(workouts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'hiit-workouts.json'; a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('import-workouts').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const imported = JSON.parse(event.target.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                const valid = imported.filter(w => w && typeof w.name === 'string');
                if (valid.length === 0) throw new Error('No valid workouts found');
                saveWorkouts([...loadWorkouts(), ...valid]);
                renderWorkoutList();
                alert(`Imported ${valid.length} workout(s).`);
            } catch(err) { alert('Import failed: ' + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // ── Playlist export / import ──────────────────────────────────────

    document.getElementById('export-playlists').addEventListener('click', () => {
        const playlists = loadPlaylists();
        if (playlists.length === 0) { alert('No saved playlists to export.'); return; }
        const blob = new Blob([JSON.stringify(playlists, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'hiit-playlists.json'; a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('import-playlists').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const imported = JSON.parse(event.target.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                const valid = imported.filter(p => p && typeof p.name === 'string' && Array.isArray(p.workoutNames));
                if (valid.length === 0) throw new Error('No valid playlists found');
                savePlaylists([...loadPlaylists(), ...valid]);
                renderPlaylistList();
                alert(`Imported ${valid.length} playlist(s).`);
            } catch(err) { alert('Import failed: ' + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // ── Playlist list rendering ───────────────────────────────────────

    function renderPlaylistList() {
        const playlists = loadPlaylists();
        if (playlists.length === 0) {
            playlistList.innerHTML = `<div class="workout-empty">No playlists yet.<br>Enter a name above and tap New.</div>`;
            return;
        }
        playlistList.innerHTML = playlists.map((p, i) => {
            const count = (p.workoutNames || []).length;
            return `
            <div class="workout-item" data-index="${i}">
                <div class="workout-item-info">
                    <div class="workout-item-name">${escHtml(p.name)}</div>
                    <div class="workout-item-detail">${count} workout${count !== 1 ? 's' : ''}</div>
                </div>
                <div class="workout-item-actions">
                    <button class="workout-action-btn play-playlist-btn" data-index="${i}" title="Play">▶</button>
                    <button class="workout-action-btn edit-playlist-btn" data-index="${i}" title="Edit">✏️</button>
                    <button class="workout-action-btn delete delete-playlist-btn" data-index="${i}" title="Delete">🗑️</button>
                </div>
            </div>`;
        }).join('');

        playlistList.querySelectorAll('.play-playlist-btn').forEach(btn => {
            btn.addEventListener('click', () => playPlaylist(parseInt(btn.dataset.index, 10)));
        });
        playlistList.querySelectorAll('.edit-playlist-btn').forEach(btn => {
            btn.addEventListener('click', () => openPlaylistEditor(parseInt(btn.dataset.index, 10)));
        });
        playlistList.querySelectorAll('.delete-playlist-btn').forEach(btn => {
            btn.addEventListener('click', () => deletePlaylist(parseInt(btn.dataset.index, 10)));
        });
    }

    document.getElementById('save-playlist').addEventListener('click', () => {
        const name = document.getElementById('playlist-name').value.trim();
        if (!name) { document.getElementById('playlist-name').focus(); return; }
        const playlists = loadPlaylists();
        playlists.push({ name, workoutNames: [] });
        savePlaylists(playlists);
        document.getElementById('playlist-name').value = '';
        renderPlaylistList();
        // Open the editor immediately so user can add workouts
        openPlaylistEditor(playlists.length - 1);
    });

    function deletePlaylist(index) {
        const playlists = loadPlaylists();
        if (!playlists[index]) return;
        if (!confirm(`Delete playlist "${playlists[index].name}"?`)) return;
        playlists.splice(index, 1);
        savePlaylists(playlists);
        renderPlaylistList();
    }

    function playPlaylist(index) {
        const playlists = loadPlaylists();
        const playlist = playlists[index];
        if (!playlist || !playlist.workoutNames.length) {
            alert('This playlist has no workouts. Edit it to add some.');
            return;
        }
        const allWorkouts = loadWorkouts();
        const workoutObjects = playlist.workoutNames.map(name => allWorkouts.find(w => w.name === name)).filter(Boolean);
        if (workoutObjects.length === 0) {
            alert('None of the workouts in this playlist exist anymore.');
            return;
        }
        const seq = buildPlaylistSchedule(workoutObjects, 5); // 5-second transitions
        activeWorkoutName = playlist.name;
        workoutNameDisplay.textContent = playlist.name;
        closeDrawer();
        startTimer(seq);
    }

    // ── Playlist editor ───────────────────────────────────────────────

    const playlistEditor = document.getElementById('playlist-editor');
    const playlistEditorOverlay = document.getElementById('playlist-editor-overlay');
    const playlistEditorTitle = document.getElementById('playlist-editor-title');
    const playlistWorkoutSearch = document.getElementById('playlist-workout-search');
    const playlistPool = document.getElementById('playlist-workout-pool');
    const playlistEntries = document.getElementById('playlist-entries');

    let editingPlaylistIndex = -1;

    function openPlaylistEditor(index) {
        editingPlaylistIndex = index;
        const playlists = loadPlaylists();
        playlistEditorTitle.textContent = playlists[index].name;
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

    document.getElementById('playlist-editor-back').addEventListener('click', () => {
        closePlaylistEditor();
        renderPlaylistList();
    });
    document.getElementById('playlist-editor-close').addEventListener('click', () => {
        closePlaylistEditor();
        closeDrawer();
    });
    playlistEditorOverlay.addEventListener('click', () => {
        closePlaylistEditor();
    });
    playlistWorkoutSearch.addEventListener('input', renderPlaylistEditor);

    function renderPlaylistEditor() {
        if (editingPlaylistIndex < 0) return;
        const playlists = loadPlaylists();
        const playlist = playlists[editingPlaylistIndex];
        if (!playlist) return;
        const allWorkouts = loadWorkouts();
        const query = playlistWorkoutSearch.value.trim().toLowerCase();
        const filtered = query ? allWorkouts.filter(w => w.name.toLowerCase().includes(query)) : allWorkouts;

        // Pool: all workouts, with + button to add
        if (filtered.length === 0) {
            playlistPool.innerHTML = `<div class="workout-empty">No workouts found.</div>`;
        } else {
            playlistPool.innerHTML = filtered.map(w => {
                const inPlaylist = playlist.workoutNames.includes(w.name);
                return `
                <div class="workout-item pool-item">
                    <div class="workout-item-info">
                        <div class="workout-item-name">${escHtml(w.name)}</div>
                        <div class="workout-item-detail">${escHtml(formatSummary(w))}</div>
                    </div>
                    <div class="workout-item-actions">
                        <button class="workout-action-btn pool-add-btn ${inPlaylist ? 'pool-added' : ''}" data-name="${escHtml(w.name)}" title="Add to playlist">+</button>
                    </div>
                </div>`;
            }).join('');

            playlistPool.querySelectorAll('.pool-add-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const playlists = loadPlaylists();
                    playlists[editingPlaylistIndex].workoutNames.push(btn.dataset.name);
                    savePlaylists(playlists);
                    renderPlaylistEditor();
                });
            });
        }

        // Entries: current playlist order, with remove + drag reorder
        if (playlist.workoutNames.length === 0) {
            playlistEntries.innerHTML = `<div class="workout-empty">Tap + to add workouts above.</div>`;
        } else {
            playlistEntries.innerHTML = playlist.workoutNames.map((name, i) => `
                <div class="workout-item" data-index="${i}" draggable="true">
                    <div class="drag-handle" title="Drag to reorder">⠿</div>
                    <div class="workout-item-info">
                        <div class="workout-item-name">${escHtml(name)}</div>
                    </div>
                    <div class="workout-item-actions">
                        <button class="workout-action-btn delete entry-remove-btn" data-index="${i}" title="Remove">✕</button>
                    </div>
                </div>`).join('');

            playlistEntries.querySelectorAll('.entry-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const playlists = loadPlaylists();
                    playlists[editingPlaylistIndex].workoutNames.splice(parseInt(btn.dataset.index, 10), 1);
                    savePlaylists(playlists);
                    renderPlaylistEditor();
                });
            });

            initDragAndDrop(playlistEntries, (fromIndex, toIndex) => {
                const playlists = loadPlaylists();
                const names = playlists[editingPlaylistIndex].workoutNames;
                const [moved] = names.splice(fromIndex, 1);
                names.splice(toIndex, 0, moved);
                savePlaylists(playlists);
                renderPlaylistEditor();
            });
        }
    }

    // ── Shared drag-and-drop ──────────────────────────────────────────

    function initDragAndDrop(listEl, onReorder) {
        const items = [...listEl.querySelectorAll('.workout-item[draggable="true"]')];
        if (items.length < 2) return;

        let dragSrc = null, dragGhost = null, offsetY = 0, active = false;

        function getItemAtY(y) {
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                if (y >= rect.top && y <= rect.bottom) return item;
            }
            return null;
        }

        function cleanup() {
            active = false;
            items.forEach(i => i.classList.remove('drag-over', 'dragging'));
            if (dragGhost) { dragGhost.remove(); dragGhost = null; }
            dragSrc = null;
        }

        items.forEach(item => {
            const handle = item.querySelector('.drag-handle');
            if (!handle) return;
            handle.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                active = true;
                dragSrc = item;
                const rect = item.getBoundingClientRect();
                offsetY = e.clientY - rect.top;
                dragGhost = item.cloneNode(true);
                dragGhost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.75;pointer-events:none;z-index:9999;background:white;border:2px solid #4ecdc4;border-radius:4px;box-sizing:border-box;`;
                document.body.appendChild(dragGhost);
                item.classList.add('dragging');
            });
        });

        document.addEventListener('pointermove', e => {
            if (!active || !dragSrc) return;
            e.preventDefault();
            dragGhost.style.top = (e.clientY - offsetY) + 'px';
            const target = getItemAtY(e.clientY);
            items.forEach(i => i.classList.remove('drag-over'));
            if (target && target !== dragSrc) target.classList.add('drag-over');
        }, { passive: false });

        document.addEventListener('pointerup', e => {
            if (!active || !dragSrc) return;
            const target = getItemAtY(e.clientY);
            if (target && target !== dragSrc) {
                onReorder(parseInt(dragSrc.dataset.index, 10), parseInt(target.dataset.index, 10));
            } else {
                cleanup();
            }
        });

        document.addEventListener('pointercancel', () => {
            if (!active) return;
            cleanup();
        });
    }

});
