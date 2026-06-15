document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const timeDisplay = document.querySelector('.time');
    const phaseLabel = document.querySelector('.phase-label');
    const setRepDisplay = document.querySelector('.set-rep-display');
    const startStopBtn = document.getElementById('start-stop');
    const resetBtn = document.getElementById('reset');
    const container = document.querySelector('.container');
    const progressBar = document.querySelector('.progress-bar');

    const inputs = {
        sets: document.getElementById('sets'),
        reps: document.getElementById('reps'),
        hold: document.getElementById('hold'),
        rest: document.getElementById('rest'),
        recover: document.getElementById('recover')
    };

    const limits = {
        sets: { min: 1, max: 10 },
        reps: { min: 1, max: 20 },
        hold: { min: 1, max: 30 },
        rest: { min: 1, max: 30 },
        recover: { min: 1, max: 60 }
    };

    const phaseColors = {
        hold: '#4caf50',    // green
        rest: '#ffd166',    // yellow
        recover: '#42a5f5'  // blue
    };

    const phaseNames = {
        hold: 'Work',
        rest: 'Rest',
        recover: 'Recover'
    };

    // Stepper buttons
    document.querySelectorAll('.stepper button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning) return;
            const target = btn.dataset.target;
            const input = inputs[target];
            const { min, max } = limits[target];
            let value = parseInt(input.value, 10);
            if (btn.classList.contains('step-up')) {
                value = Math.min(max, value + 1);
            } else {
                value = Math.max(min, value - 1);
            }
            input.value = value;
            if (target === 'hold' && !isRunning && !isPaused) {
                currentDuration = value;
                timeRemaining = value;
                updateTimeDisplay();
            }
        });
    });

    // Audio context
    let audioContext;
    let audioInitialized = false;

    function initAudio() {
        if (audioInitialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext();
            audioInitialized = true;
        } catch (e) {
            console.error('Error initializing audio:', e);
        }
    }

    function playBeep(type = 'sine', frequency = 800, duration = 200) {
        if (!audioInitialized) {
            initAudio();
            if (!audioInitialized) return;
        }
        try {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.type = type;
            oscillator.frequency.value = frequency;
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.01);
            gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);

            oscillator.start();
            oscillator.stop(audioContext.currentTime + duration / 1000);
        } catch (e) {
            console.error('Error playing sound:', e);
        }
    }

    function initAudioOnFirstInteraction() {
        if (audioContext?.state === 'suspended') {
            audioContext.resume();
        } else if (!audioInitialized) {
            initAudio();
        }
    }

    document.addEventListener('click', initAudioOnFirstInteraction, { once: true });
    document.addEventListener('keydown', initAudioOnFirstInteraction, { once: true });
    initAudio();

    // Timer state
    let isRunning = false;
    let isPaused = false;
    let timerInterval;

    let schedule = [];      // array of { type, set, rep, duration }
    let stepIndex = 0;
    let timeRemaining = 0;
    let currentDuration = 0;

    function buildSchedule() {
        const sets = parseInt(inputs.sets.value, 10);
        const reps = parseInt(inputs.reps.value, 10);
        const hold = parseInt(inputs.hold.value, 10);
        const rest = parseInt(inputs.rest.value, 10);
        const recover = parseInt(inputs.recover.value, 10);

        const seq = [];
        for (let s = 1; s <= sets; s++) {
            for (let r = 1; r <= reps; r++) {
                seq.push({ type: 'hold', set: s, rep: r, duration: hold });
                if (r < reps) {
                    seq.push({ type: 'rest', set: s, rep: r, duration: rest });
                }
            }
            if (s < sets) {
                seq.push({ type: 'recover', set: s, rep: reps, duration: recover });
            }
        }
        return seq;
    }

    function setInputsDisabled(disabled) {
        document.querySelectorAll('.stepper button, .stepper input').forEach(el => {
            el.disabled = disabled;
        });
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

    function updateTimeDisplay() {
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        const progress = ((currentDuration - timeRemaining) / currentDuration) * 100;
        progressBar.style.setProperty('--progress', `${progress}%`);
    }

    function tick() {
        timeRemaining--;
        if (timeRemaining < 0) {
            advanceStep();
            return;
        }
        updateTimeDisplay();
    }

    function advanceStep() {
        playBeep('sine', 800, 50);
        stepIndex++;
        if (stepIndex >= schedule.length) {
            workoutComplete();
            return;
        }
        loadStep(stepIndex);
    }

    function startTimer() {
        if (!isRunning && !isPaused) {
            // Fresh start
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
        if (isRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    }

    const defaults = {
        sets: 2,
        reps: 2,
        hold: 10,
        rest: 4,
        recover: 30
    };

    function resetTimer() {
        clearInterval(timerInterval);
        isRunning = false;
        isPaused = false;
        stepIndex = 0;
        schedule = [];
        container.classList.remove('timer-running');
        setInputsDisabled(false);
        startStopBtn.textContent = 'Start';

        Object.keys(defaults).forEach(key => {
            inputs[key].value = defaults[key];
        });

        // Reset display to defaults reflecting current settings (first phase = hold)
        const hold = parseInt(inputs.hold.value, 10);
        currentDuration = hold;
        timeRemaining = hold;
        phaseLabel.textContent = 'Ready';
        setRepDisplay.textContent = 'Set 1 / Rep 1';
        container.style.setProperty('--phase-color', phaseColors.hold);
        progressBar.style.setProperty('--progress', '0%');
        updateTimeDisplay();
        progressBar.style.background = '';
    }

    function workoutComplete() {
        clearInterval(timerInterval);
        isRunning = false;
        isPaused = false;

        // Play alarm sound
        const alarmInterval = setInterval(() => {
            playBeep('sine', 800, 50);
        }, 300);

        setTimeout(() => {
            clearInterval(alarmInterval);
        }, 3000);

        // Visual feedback - flash progress bar
        let isRed = false;
        let flashCount = 0;

        const flashInterval = setInterval(() => {
            isRed = !isRed;
            if (isRed) {
                progressBar.style.background = 'conic-gradient(red 0%, red 100%)';
            } else {
                progressBar.style.background = 'conic-gradient(transparent 0%, transparent 100%)';
            }
            flashCount++;

            if (flashCount >= 10) {
                clearInterval(flashInterval);
                progressBar.style.background = '';
                resetTimer();
            }
        }, 500);
    }

    // Event Listeners
    startStopBtn.addEventListener('click', startStopHandler);
    resetBtn.addEventListener('click', resetTimer);

    // Update preview circle color when Hold value changes (pre-start)
    inputs.hold.addEventListener('change', () => {
        if (!isRunning && !isPaused) {
            const hold = parseInt(inputs.hold.value, 10);
            currentDuration = hold;
            timeRemaining = hold;
            updateTimeDisplay();
        }
    });

    // Initial display
    resetTimer();

    // Prevent spacebar from scrolling the page when buttons are focused
    document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && e.target.tagName === 'BUTTON') {
            e.preventDefault();
        }
    });
});
