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
        recover: '#42a5f5'
    };
    const phaseNames = {
        work: 'Work',
        rest: 'Rest',
        recover: 'Recover'
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

    function buildSchedule() {
        const sets = parseInt(intInputs.sets.value, 10);
        const reps = parseInt(intInputs.reps.value, 10);
        const work = getMmssTotal('work');
        const rest = checkboxes.rest.checked ? getMmssTotal('rest') : 0;
        const recover = checkboxes.recover.checked ? getMmssTotal('recover') : 0;
        const seq = [];
        for (let s = 1; s <= sets; s++) {
            for (let r = 1; r <= reps; r++) {
                seq.push({ type: 'work', set: s, rep: r, duration: work });
                if (r < reps && rest > 0) {
                    seq.push({ type: 'rest', set: s, rep: r, duration: rest });
                }
            }
            if (s < sets && recover > 0) {
                seq.push({ type: 'recover', set: s, rep: reps, duration: recover });
            }
        }
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
        phaseLabel.textContent = phaseNames[step.type];
        const totalSets = parseInt(intInputs.sets.value, 10);
        const totalReps = parseInt(intInputs.reps.value, 10);
        setDisplay.textContent = `Set ${step.set} of ${totalSets}`;
        repDisplay.textContent = `Rep ${step.rep} of ${totalReps}`;
        container.style.setProperty('--phase-color', phaseColors[step.type]);
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

    function startTimer() {
        if (!isRunning && !isPaused) {
            schedule = buildSchedule();
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

    // Keep old name as alias so existing calls still work
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

    // ── Workout Library ──────────────────────────────────────────────

    const WORKOUTS_KEY = 'hiitWorkouts';
    const drawer = document.getElementById('workout-drawer');
    const overlay = document.getElementById('drawer-overlay');
    const openLibraryBtn = document.getElementById('open-library');
    const closeDrawerBtn = document.getElementById('close-drawer');
    const workoutNameInput = document.getElementById('workout-name');
    const saveWorkoutBtn = document.getElementById('save-workout');
    const workoutSearchInput = document.getElementById('workout-search');
    const workoutList = document.getElementById('workout-list');

    function openDrawer() {
        drawer.classList.add('open');
        overlay.classList.add('open');
        renderWorkoutList();
        workoutNameInput.focus();
    }

    function closeDrawer() {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    }

    openLibraryBtn.addEventListener('click', openDrawer);
    closeDrawerBtn.addEventListener('click', closeDrawer);
    function overlayCloseGuard() {
        if (workoutList.querySelector('.workout-rename-input')) return;
        closeDrawer();
    }
    overlay.addEventListener('click', overlayCloseGuard);
    overlay.addEventListener('touchstart', overlayCloseGuard);

    workoutSearchInput.addEventListener('input', renderWorkoutList);

    function loadWorkouts() {
        try {
            return JSON.parse(localStorage.getItem(WORKOUTS_KEY) || '[]');
        } catch(e) { return []; }
    }

    function saveWorkouts(workouts) {
        localStorage.setItem(WORKOUTS_KEY, JSON.stringify(workouts));
    }

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

    function renderWorkoutList() {
        const workouts = loadWorkouts();
        const query = workoutSearchInput.value.trim().toLowerCase();
        const filtered = query
            ? workouts.filter(w => w.name.toLowerCase().includes(query))
            : workouts;
        const isFiltered = !!query;

        if (filtered.length === 0) {
            workoutList.innerHTML = `<div class="workout-empty">${query ? 'No workouts match your search.' : 'No saved workouts yet.<br>Set up a workout and hit Save!'}</div>`;
            return;
        }

        workoutList.innerHTML = filtered.map((w) => {
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
                    <button class="workout-action-btn rename-btn" data-index="${realIndex}" title="Rename">✏️</button>
                    <button class="workout-action-btn delete delete-btn" data-index="${realIndex}" title="Delete">🗑️</button>
                </div>
            </div>`;
        }).join('');

        // Load on name click
        workoutList.querySelectorAll('.workout-item-info').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.closest('.workout-item').dataset.index, 10);
                loadWorkout(idx);
            });
        });
        workoutList.querySelectorAll('.load-btn').forEach(btn => {
            btn.addEventListener('click', () => loadWorkout(parseInt(btn.dataset.index, 10)));
        });
        workoutList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', () => startRename(parseInt(btn.dataset.index, 10)));
        });
        workoutList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteWorkout(parseInt(btn.dataset.index, 10)));
        });

        if (!isFiltered) initDragAndDrop();
    }

    function escHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function initDragAndDrop() {
        const items = [...workoutList.querySelectorAll('.workout-item[draggable="true"]')];
        let dragSrc = null;

        items.forEach(item => {
            item.addEventListener('dragstart', e => {
                dragSrc = item;
                e.dataTransfer.effectAllowed = 'move';
                // Slight delay so the drag image renders before we style the source
                setTimeout(() => item.classList.add('dragging'), 0);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                workoutList.querySelectorAll('.workout-item').forEach(i => i.classList.remove('drag-over'));
                dragSrc = null;
            });

            item.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (item !== dragSrc) {
                    workoutList.querySelectorAll('.workout-item').forEach(i => i.classList.remove('drag-over'));
                    item.classList.add('drag-over');
                }
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', e => {
                e.preventDefault();
                if (!dragSrc || dragSrc === item) return;
                item.classList.remove('drag-over');

                const fromIndex = parseInt(dragSrc.dataset.index, 10);
                const toIndex = parseInt(item.dataset.index, 10);
                const workouts = loadWorkouts();
                const [moved] = workouts.splice(fromIndex, 1);
                workouts.splice(toIndex, 0, moved);
                saveWorkouts(workouts);
                renderWorkoutList();
            });
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
        const currentName = workouts[index].name;
        nameDiv.innerHTML = `<input class="workout-rename-input" value="${escHtml(currentName)}" maxlength="40">`;
        const input = nameDiv.querySelector('input');
        input.focus();
        input.select();

        function commitRename() {
            cleanup();
            const newName = input.value.trim();
            if (newName) workouts[index].name = newName;
            saveWorkouts(workouts);
            renderWorkoutList();
        }

        function cancelRename() {
            cleanup();
            renderWorkoutList();
        }

        function onDocPointerDown(e) {
            if (!input.contains(e.target)) commitRename();
        }

        function cleanup() {
            document.removeEventListener('mousedown', onDocPointerDown);
            document.removeEventListener('touchstart', onDocPointerDown);
            input.removeEventListener('keydown', onKeyDown);
        }

        function onKeyDown(e) {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { cancelRename(); }
        }

        // Slight delay so the tap that opened rename doesn't immediately commit
        setTimeout(() => {
            document.addEventListener('mousedown', onDocPointerDown);
            document.addEventListener('touchstart', onDocPointerDown);
        }, 100);
        input.addEventListener('keydown', onKeyDown);
    }

});
