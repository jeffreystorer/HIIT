document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const timeDisplay = document.querySelector('.time');
    const phaseLabel = document.querySelector('.phase-label');
    const setRepDisplay = document.querySelector('.set-rep-display');
    const startStopBtn = document.getElementById('start-stop');
    const resetBtn = document.getElementById('reset');
    const container = document.querySelector('.container');
    const progressBar = document.querySelector('.progress-bar');

    // Simple integer inputs
    const intInputs = {
        sets: document.getElementById('sets'),
        reps: document.getElementById('reps')
    };
    const intLimits = {
        sets: { min: 1, max: 10 },
        reps: { min: 1, max: 20 }
    };

    // MM:SS inputs — each has a -min, -sec pair
    // totalSeconds() helpers are defined per field
    const mmssFields = ['hold', 'rest', 'recover'];
    const mmssInputs = {};
    mmssFields.forEach(f => {
        mmssInputs[f] = {
            min: document.getElementById(f + '-min'),
            sec: document.getElementById(f + '-sec')
        };
    });

    // Min total seconds for each mmss field (hold=1, rest/recover=0)
    const mmssMinTotal = { hold: 1, rest: 0, recover: 0 };
    const mmssMaxTotal = 3600; // 60 minutes

    function getMmssTotal(field) {
        return parseInt(mmssInputs[field].min.value, 10) * 60
             + parseInt(mmssInputs[field].sec.value, 10);
    }

    function setMmssTotal(field, totalSec) {
        totalSec = Math.max(mmssMinTotal[field], Math.min(mmssMaxTotal, totalSec));
        mmssInputs[field].min.value = Math.floor(totalSec / 60);
        mmssInputs[field].sec.value = totalSec % 60;
    }

    // Phase colors and names
    const phaseColors = {
        hold: '#4caf50',
        rest: '#ffd166',
        recover: '#42a5f5'
    };
    const phaseNames = {
        hold: 'Work',
        rest: 'Rest',
        recover: 'Recover'
    };

    // Stepper buttons
    document.querySelectorAll('.stepper button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning || isPaused) return;
            const target = btn.dataset.target;
            const isUp = btn.classList.contains('step-up');

            // MM:SS field?
            const mmssMatch = target.match(/^(hold|rest|recover)-(min|sec)$/);
            if (mmssMatch) {
                const field = mmssMatch[1];
                const part = mmssMatch[2];
                let total = getMmssTotal(field);
                total += isUp ? (part === 'min' ? 60 : 1)
                              : (part === 'min' ? -60 : -1);
                setMmssTotal(field, total);
                if (field === 'hold') updateHoldPreview();
                return;
            }

            // Integer field
            const input = intInputs[target];
            const { min, max } = intLimits[target];
            let value = parseInt(input.value, 10);
            value = isUp ? Math.min(max, value + 1) : Math.max(min, value - 1);
            input.value = value;
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
        const hold = getMmssTotal('hold');
        const rest = getMmssTotal('rest');
        const recover = getMmssTotal('recover');
        const seq = [];
        for (let s = 1; s <= sets; s++) {
            for (let r = 1; r <= reps; r++) {
                seq.push({ type: 'hold', set: s, rep: r, duration: hold });
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
    }

    function loadStep(index) {
        const step = schedule[index];
        currentDuration = step.duration;
        timeRemaining = step.duration;
        phaseLabel.textContent = phaseNames[step.type];
        setRepDisplay.textContent = `Set ${step.set} / Rep ${step.rep}`;
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

    // Defaults — stored as total seconds internally
    const defaultStorageKey = 'hiitTimerDefaultsV2';
    const hardDefaults = { sets: 2, reps: 2, hold: 10, rest: 4, recover: 30 };
    let defaults = { ...hardDefaults };

    function loadSavedDefaults() {
        try {
            const saved = localStorage.getItem(defaultStorageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                ['sets','reps','hold','rest','recover'].forEach(k => {
                    if (typeof parsed[k] === 'number') defaults[k] = parsed[k];
                });
            }
        } catch(e) { console.error('Load defaults error:', e); }
    }

    function saveDefaults() {
        defaults.sets = parseInt(intInputs.sets.value, 10);
        defaults.reps = parseInt(intInputs.reps.value, 10);
        defaults.hold = getMmssTotal('hold');
        defaults.rest = getMmssTotal('rest');
        defaults.recover = getMmssTotal('recover');
        try {
            localStorage.setItem(defaultStorageKey, JSON.stringify(defaults));
        } catch(e) { console.error('Save defaults error:', e); }
    }

    function applyDefaults() {
        intInputs.sets.value = defaults.sets;
        intInputs.reps.value = defaults.reps;
        setMmssTotal('hold', defaults.hold);
        setMmssTotal('rest', defaults.rest);
        setMmssTotal('recover', defaults.recover);
    }

    function updateHoldPreview() {
        if (!isRunning && !isPaused) {
            currentDuration = getMmssTotal('hold');
            timeRemaining = currentDuration;
            timeDisplay.textContent = formatTime(timeRemaining);
            progressBar.style.setProperty('--progress', '0%');
        }
    }

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
        phaseLabel.textContent = 'Ready';
        setRepDisplay.textContent = 'Set 1 / Rep 1';
        container.style.setProperty('--phase-color', phaseColors.hold);
        progressBar.style.setProperty('--progress', '0%');
        progressBar.style.background = '';
        updateHoldPreview();
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

    // Event listeners
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

    // Init
    loadSavedDefaults();
    resetTimer();
});
