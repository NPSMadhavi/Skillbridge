import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { api } from '../../services/api'

// Ordered Challenge Steps
const ENROLLMENT_STEPS = [
  {
    id: 'look_straight',
    label: 'Look Straight',
    instruction: 'Look directly into the camera with a neutral expression',
    icon: '🎯',
  },
  {
    id: 'look_up',
    label: 'Tilt Up',
    instruction: 'Slowly tilt your head slightly UP',
    icon: '⬆️',
  },
  {
    id: 'turn_left',
    label: 'Turn Left',
    instruction: 'Turn your head slightly to your LEFT',
    icon: '⬅️',
  },
  {
    id: 'turn_right',
    label: 'Turn Right',
    instruction: 'Turn your head slightly to your RIGHT',
    icon: '➡️',
  },
  {
    id: 'look_down',
    label: 'Tilt Down',
    instruction: 'Slowly tilt your head slightly DOWN',
    icon: '⬇️',
  },
]

const POSE_HOLD_MS = 800

/**
 * Calculates head pose angles (yaw, pitch, roll) from MediaPipe 478 landmarks.
 * Landmarks:
 * 1: Nose tip
 * 152: Chin
 * 10: Forehead top
 * 33: Left eye outer
 * 263: Right eye outer
 * 234: Left cheek / temple
 * 454: Right cheek / temple
 */
function estimateHeadPose(landmarks) {
  const nose = landmarks[1]
  const chin = landmarks[152]
  const forehead = landmarks[10]
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]

  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeMidY = (leftEye.y + rightEye.y) / 2
  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1

  // Yaw: horizontal displacement of nose from eye midpoint normalized by eye distance
  // In mirrored view: user turns left -> nose shifts in negative x direction
  const rawYaw = (nose.x - eyeMidX) / eyeDist

  // Pitch: vertical displacement of nose relative to eye line and chin
  const verticalFaceSpan = Math.abs(chin.y - forehead.y) || 1
  const eyeToNose = nose.y - eyeMidY
  const noseToChin = chin.y - nose.y
  const rawPitchRatio = noseToChin > 0.01 ? eyeToNose / noseToChin : 1.0

  // Roll: angle of the line connecting eyes
  const rollDeg = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI

  return {
    rawYaw,
    rawPitchRatio,
    rollDeg,
    verticalFaceSpan,
  }
}

/**
 * Verifies if the estimated pose satisfies the current challenge step.
 */
function verifyStepPose(stepId, pose) {
  const { rawYaw, rawPitchRatio, rollDeg } = pose

  // Reject excessive head tilt
  if (Math.abs(rollDeg) > 18) {
    return { valid: false, message: 'Keep your head level (avoid tilting sideways)' }
  }

  switch (stepId) {
    case 'look_straight': {
      const isYawStraight = Math.abs(rawYaw) < 0.12
      const isPitchStraight = rawPitchRatio >= 0.55 && rawPitchRatio <= 0.95
      if (isYawStraight && isPitchStraight) {
        return { valid: true, message: 'Good! Hold still...' }
      }
      if (!isYawStraight) return { valid: false, message: 'Face directly forward' }
      if (rawPitchRatio < 0.55) return { valid: false, message: 'Tilt head down slightly' }
      return { valid: false, message: 'Tilt head up slightly' }
    }
    case 'look_up': {
      // Nose moves up towards eye line -> rawPitchRatio drops below 0.48
      if (rawPitchRatio < 0.48 && Math.abs(rawYaw) < 0.22) {
        return { valid: true, message: 'Great! Hold position...' }
      }
      return { valid: false, message: 'Tilt your chin and head UP slightly' }
    }
    case 'turn_left': {
      // User turns left (in mirrored webcam: nose moves to the left side)
      if (rawYaw < -0.16 && rawPitchRatio >= 0.45 && rawPitchRatio <= 1.05) {
        return { valid: true, message: 'Perfect! Hold position...' }
      }
      return { valid: false, message: 'Turn your head to the LEFT' }
    }
    case 'turn_right': {
      // User turns right (in mirrored webcam: nose moves to the right side)
      if (rawYaw > 0.16 && rawPitchRatio >= 0.45 && rawPitchRatio <= 1.05) {
        return { valid: true, message: 'Great! Hold position...' }
      }
      return { valid: false, message: 'Turn your head to the RIGHT' }
    }
    case 'look_down': {
      // Nose moves down towards chin -> rawPitchRatio increases above 1.05
      if (rawPitchRatio > 1.05 && Math.abs(rawYaw) < 0.22) {
        return { valid: true, message: 'Good! Hold position...' }
      }
      return { valid: false, message: 'Tilt your chin and head DOWN slightly' }
    }
    default:
      return { valid: false, message: 'Adjust position' }
  }
}

/**
 * Validates face frame illumination and blurriness using an offscreen canvas.
 */
function analyzeFrameQuality(video, box, canvas) {
  if (!video || !video.videoWidth) return { valid: true }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const vw = video.videoWidth
  const vh = video.videoHeight

  // Bounding box in pixels
  const x1 = Math.max(0, Math.floor(box.xMin * vw))
  const y1 = Math.max(0, Math.floor(box.yMin * vh))
  const bw = Math.min(vw - x1, Math.floor((box.xMax - box.xMin) * vw))
  const bh = Math.min(vh - y1, Math.floor((box.yMax - box.yMin) * vh))

  if (bw < 30 || bh < 30) return { valid: false, reason: 'Face area too small' }

  canvas.width = 64
  canvas.height = 64
  ctx.drawImage(video, x1, y1, bw, bh, 0, 0, 64, 64)

  const imgData = ctx.getImageData(0, 0, 64, 64)
  const data = imgData.data

  // 1. Average Brightness
  let totalLuma = 0
  const gray = new Float32Array(64 * 64)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[j] = luma
    totalLuma += luma
  }
  const avgBrightness = totalLuma / (64 * 64)

  if (avgBrightness < 45) {
    return { valid: false, reason: 'Lighting too dark. Face a light source.' }
  }
  if (avgBrightness > 225) {
    return { valid: false, reason: 'Too much bright glare / overexposed.' }
  }

  // 2. Laplacian Blur Estimation
  let lapSum = 0
  let lapSqSum = 0
  let count = 0
  for (let y = 1; y < 63; y++) {
    for (let x = 1; x < 63; x++) {
      const idx = y * 64 + x
      const lap =
        gray[idx - 64] +
        gray[idx + 64] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx]
      lapSum += lap
      lapSqSum += lap * lap
      count++
    }
  }
  const variance = count > 0 ? (lapSqSum - (lapSum * lapSum) / count) / count : 100

  if (variance < 25) {
    return { valid: false, reason: 'Camera blurry or moving. Hold steady.' }
  }

  return { valid: true }
}

const FaceEnrollmentModal = ({ isOpen, onClose, onEnrollmentComplete }) => {
  const [stepIndex, setStepIndex] = useState(0)
  const [sessionData, setSessionData] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Initializing Face Landmarker...')
  const [feedbackColor, setFeedbackColor] = useState('amber') // 'amber' | 'emerald' | 'rose'
  const [holdProgress, setHoldProgress] = useState(0)
  const [completedSteps, setCompletedSteps] = useState({})
  const [capturedFrames, setCapturedFrames] = useState({})
  const [isVerifying, setIsVerifying] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [isModelLoading, setIsModelLoading] = useState(true)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const landmarkerRef = useRef(null)
  const animationFrameRef = useRef(null)
  const offscreenCanvasRef = useRef(document.createElement('canvas'))
  const holdStartTimeRef = useRef(null)
  const capturedFramesRef = useRef({})
  const stepIndexRef = useRef(0)
  const sessionDataRef = useRef(null)
  const isVerifyingRef = useRef(false)

  stepIndexRef.current = stepIndex
  capturedFramesRef.current = capturedFrames
  sessionDataRef.current = sessionData
  isVerifyingRef.current = isVerifying

  // Stop camera tracks cleanly
  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  // 1. Initialize MediaPipe FaceLandmarker and Session on open
  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      return
    }

    let isCancelled = false

    async function init() {
      setCameraError('')
      setIsModelLoading(true)
      setStatusMessage('Starting secure enrollment session...')

      try {
        // Start server session
        const session = await api.startFaceEnrollmentSession()
        if (isCancelled) return
        sessionDataRef.current = session
        setSessionData(session)

        setStatusMessage('Loading MediaPipe Face Landmarker...')

        // Load MediaPipe Face Landmarker
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
        )
        if (isCancelled) return

        const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: false,
          runningMode: 'VIDEO',
          numFaces: 2, // Allows checking for multiple faces
        })

        if (isCancelled) return
        landmarkerRef.current = faceLandmarker
        setIsModelLoading(false)

        // Open Camera
        setStatusMessage('Requesting camera access...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        })

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setStatusMessage('Align your face inside the guide.')
        startDetectionLoop()
      } catch (err) {
        console.error('Face enrollment setup error:', err)
        if (!isCancelled) {
          setCameraError(
            err.message ||
              'Could not access webcam or load face detector. Please check permissions and HTTPS.'
          )
          setIsModelLoading(false)
        }
      }
    }

    init()

    return () => {
      isCancelled = true
      stopCamera()
    }
  }, [isOpen])

  // Continuous Detection Loop
  const startDetectionLoop = () => {
    let lastVideoTime = -1

    const processFrame = () => {
      const video = videoRef.current
      const landmarker = landmarkerRef.current

      if (!video || !landmarker || video.paused || video.ended || isVerifyingRef.current) {
        animationFrameRef.current = requestAnimationFrame(processFrame)
        return
      }

      if (video.currentTime !== lastVideoTime && video.videoWidth > 0) {
        lastVideoTime = video.currentTime
        const timestamp = performance.now()

        try {
          const results = landmarker.detectForVideo(video, timestamp)
          handleLandmarkResults(results)
        } catch (e) {
          console.warn('Landmark detection warning:', e)
        }
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    animationFrameRef.current = requestAnimationFrame(processFrame)
  }

  // Handle detection results for active step
  const handleLandmarkResults = (results) => {
    if (isVerifyingRef.current) return
    const currentStep = ENROLLMENT_STEPS[stepIndexRef.current]
    if (!currentStep) return

    // 1. Face Count Check
    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('rose')
      setStatusMessage('No face detected. Center yourself in the camera.')
      return
    }

    if (results.faceLandmarks.length > 1) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('rose')
      setStatusMessage('Multiple faces detected! Only one person permitted.')
      return
    }

    const landmarks = results.faceLandmarks[0]

    // 2. Bounding Box & Boundary Check
    let xMin = 1,
      xMax = 0,
      yMin = 1,
      yMax = 0
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i]
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }

    if (xMin < 0.05 || xMax > 0.95 || yMin < 0.05 || yMax > 0.95) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('amber')
      setStatusMessage('Keep your entire face inside the frame.')
      return
    }

    // 3. Distance / Face Size Check
    const faceHeight = yMax - yMin
    if (faceHeight < 0.28) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('amber')
      setStatusMessage('Move closer to the camera (face too small).')
      return
    }
    if (faceHeight > 0.72) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('amber')
      setStatusMessage('Move slightly further from the camera.')
      return
    }

    // 4. Illumination & Blur Quality Check
    const quality = analyzeFrameQuality(
      videoRef.current,
      { xMin, xMax, yMin, yMax },
      offscreenCanvasRef.current
    )
    if (!quality.valid) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('amber')
      setStatusMessage(quality.reason)
      return
    }

    // 5. Pose Estimation Check
    const pose = estimateHeadPose(landmarks)
    const poseCheck = verifyStepPose(currentStep.id, pose)

    if (!poseCheck.valid) {
      holdStartTimeRef.current = null
      setHoldProgress(0)
      setFeedbackColor('amber')
      setStatusMessage(poseCheck.message)
      return
    }

    // 6. Pose Satisfied -> Hold Duration Timer
    setFeedbackColor('emerald')
    setStatusMessage(poseCheck.message)

    const now = performance.now()
    if (!holdStartTimeRef.current) {
      holdStartTimeRef.current = now
    }

    const elapsed = now - holdStartTimeRef.current
    const progress = Math.min(100, Math.round((elapsed / POSE_HOLD_MS) * 100))
    setHoldProgress(progress)

    if (elapsed >= POSE_HOLD_MS) {
      // Capture frame for this step
      captureStepSnapshot(currentStep.id, pose)
    }
  }

  // Capture high-resolution JPEG snapshot for the validated step
  const captureStepSnapshot = (stepId, pose) => {
    holdStartTimeRef.current = null
    setHoldProgress(0)

    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

    const updatedFrames = {
      ...capturedFramesRef.current,
      [stepId]: dataUrl,
    }
    capturedFramesRef.current = updatedFrames
    setCapturedFrames(updatedFrames)
    setCompletedSteps((prev) => ({ ...prev, [stepId]: true }))

    const nextIndex = stepIndexRef.current + 1

    if (nextIndex < ENROLLMENT_STEPS.length) {
      stepIndexRef.current = nextIndex
      setStepIndex(nextIndex)
      setStatusMessage(`Great! Now ${ENROLLMENT_STEPS[nextIndex].instruction}`)
      setFeedbackColor('amber')
    } else {
      // All 5 steps completed -> Trigger Server Verification
      finalizeEnrollment(updatedFrames)
    }
  }

  // Submit all 5 captured frames to Python AI microservice
  const finalizeEnrollment = async (allFrames) => {
    if (isVerifyingRef.current) return
    isVerifyingRef.current = true
    setIsVerifying(true)

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    setStatusMessage('Verifying 3D liveness, parallax motion, and anti-spoofing on server...')
    setFeedbackColor('emerald')

    try {
      let activeSession = sessionDataRef.current || sessionData
      if (!activeSession?.session_id) {
        console.warn('Session was not cached in ref, requesting on the fly...')
        activeSession = await api.startFaceEnrollmentSession()
        sessionDataRef.current = activeSession
        setSessionData(activeSession)
      }

      const payload = {
        session_id: activeSession.session_id,
        frames: allFrames,
        metadata: {
          client_timestamp: Date.now(),
          steps_completed: ENROLLMENT_STEPS.map((s) => s.id),
        },
      }

      const result = await api.completeFaceEnrollment(payload)
      console.log('[Face Enrollment Completed]:', result)

      // Notify parent component with verified enrollment payload
      onEnrollmentComplete({
        encryptedEmbedding: result.encrypted_embedding,
        thumbnailImage: result.thumbnail_image,
        sessionId: result.session_id,
        livenessVerified: true,
      })

      stopCamera()
      onClose()
    } catch (err) {
      console.error('Enrollment completion error:', err)
      isVerifyingRef.current = false
      setIsVerifying(false)
      setCameraError(err.message || 'Liveness verification failed on server. Please restart enrollment.')
    }
  }

  const restartEnrollment = async () => {
    setCameraError('')
    setStepIndex(0)
    stepIndexRef.current = 0
    setCompletedSteps({})
    setCapturedFrames({})
    capturedFramesRef.current = {}
    holdStartTimeRef.current = null
    setHoldProgress(0)
    isVerifyingRef.current = false
    setIsVerifying(false)

    try {
      setStatusMessage('Requesting fresh enrollment session...')
      const session = await api.startFaceEnrollmentSession()
      sessionDataRef.current = session
      setSessionData(session)
      setStatusMessage('Align your face inside the guide.')
      setFeedbackColor('amber')
      startDetectionLoop()
    } catch (e) {
      setCameraError(e.message || 'Failed to start a new enrollment session.')
    }
  }

  if (!isOpen) return null

  const currentStep = ENROLLMENT_STEPS[stepIndex] || ENROLLMENT_STEPS[0]

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/70 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="face-enrollment-title"
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-line bg-panel p-6 shadow-2xl animate-rise-in my-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 id="face-enrollment-title" className="font-display text-xl font-bold text-fg">
              Real-Time Face Enrollment
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Guided 5-point liveness challenge with anti-spoofing verification
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-ink hover:text-fg transition"
          >
            ✕
          </button>
        </div>

        {/* Step Progress Indicators */}
        <div className="mt-4 flex items-center justify-between gap-1.5 rounded-2xl bg-ink/60 p-2 border border-line/60">
          {ENROLLMENT_STEPS.map((step, idx) => {
            const isDone = completedSteps[step.id]
            const isCurrent = idx === stepIndex
            return (
              <div
                key={step.id}
                className={`flex-1 flex flex-col items-center py-1.5 px-1 rounded-xl text-center transition ${
                  isDone
                    ? 'bg-ok/15 text-ok'
                    : isCurrent
                    ? 'bg-sky/20 text-sky font-semibold shadow-sm'
                    : 'text-muted/60'
                }`}
              >
                <span className="text-sm">{isDone ? '✓' : step.icon}</span>
                <span className="text-[10px] mt-0.5 whitespace-nowrap">{step.label}</span>
              </div>
            )
          })}
        </div>

        {/* Camera Viewport with Face Guide Overlay */}
        <div className="relative mt-4 overflow-hidden rounded-2xl border border-line bg-black aspect-4/3 flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full scale-x-[-1] object-cover"
          />

          {/* Alignment Oval Frame Guide */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className={`relative h-[78%] w-[62%] rounded-[50%] border-4 transition-colors duration-300 shadow-[0_0_20px_rgba(0,0,0,0.5)] ${
                feedbackColor === 'emerald'
                  ? 'border-emerald-400/90 shadow-[0_0_25px_rgba(52,211,153,0.35)]'
                  : feedbackColor === 'rose'
                  ? 'border-rose-500/90 shadow-[0_0_25px_rgba(244,63,94,0.35)]'
                  : 'border-amber-400/80 shadow-[0_0_25px_rgba(251,191,36,0.25)]'
              }`}
            >
              {/* Center Crosshair for Look Straight */}
              {currentStep.id === 'look_straight' && (
                <div className="absolute inset-0 grid place-items-center opacity-30">
                  <div className="h-6 w-0.5 bg-white" />
                  <div className="h-0.5 w-6 bg-white absolute" />
                </div>
              )}

              {/* Direction Indicator Visual Arrows */}
              {currentStep.id === 'look_up' && (
                <div className="absolute top-4 inset-x-0 flex justify-center animate-bounce">
                  <span className="rounded-full bg-sky/80 px-2 py-0.5 text-xs text-white font-bold shadow">
                    ▲ TILT UP
                  </span>
                </div>
              )}
              {currentStep.id === 'turn_left' && (
                <div className="absolute left-2 inset-y-0 flex items-center animate-pulse">
                  <span className="rounded-full bg-sky/80 px-2 py-0.5 text-xs text-white font-bold shadow">
                    ◄ TURN LEFT
                  </span>
                </div>
              )}
              {currentStep.id === 'turn_right' && (
                <div className="absolute right-2 inset-y-0 flex items-center animate-pulse">
                  <span className="rounded-full bg-sky/80 px-2 py-0.5 text-xs text-white font-bold shadow">
                    TURN RIGHT ►
                  </span>
                </div>
              )}
              {currentStep.id === 'look_down' && (
                <div className="absolute bottom-4 inset-x-0 flex justify-center animate-bounce">
                  <span className="rounded-full bg-sky/80 px-2 py-0.5 text-xs text-white font-bold shadow">
                    ▼ TILT DOWN
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Circular Hold Progress Bar (SVG ring) */}
          {holdProgress > 0 && !isVerifying && (
            <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 bg-navy/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-line">
              <svg className="h-5 w-5 -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-700"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-emerald-400 transition-all duration-75"
                  strokeDasharray={`${holdProgress}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="text-xs font-semibold text-emerald-400">Holding...</span>
            </div>
          )}

          {/* Verifying Overlay */}
          {isVerifying && (
            <div className="absolute inset-0 grid place-items-center bg-navy/85 backdrop-blur-md">
              <div className="flex flex-col items-center gap-3 text-center px-4">
                <div className="h-10 w-10 animate-spin rounded-full border-3 border-sky border-t-transparent" />
                <p className="font-display font-semibold text-fg">Verifying Biometrics</p>
                <p className="text-xs text-muted max-w-xs">
                  Running 3D parallax analysis, texture verification, and anti-spoofing checks...
                </p>
              </div>
            </div>
          )}

          {/* Loading Model Overlay */}
          {isModelLoading && (
            <div className="absolute inset-0 grid place-items-center bg-navy/90 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky border-t-transparent" />
                <p className="text-sm font-medium text-fg">Initializing MediaPipe Detector...</p>
              </div>
            </div>
          )}
        </div>

        {/* Real-time Instructions & Feedback Banner */}
        <div
          className={`mt-3.5 rounded-xl border p-3 text-center transition-colors ${
            feedbackColor === 'emerald'
              ? 'border-ok/30 bg-ok/10 text-ok'
              : feedbackColor === 'rose'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          <p className="text-sm font-semibold">{statusMessage}</p>
          <p className="mt-0.5 text-xs opacity-80">{currentStep.instruction}</p>
        </div>

        {/* Camera Error Message */}
        {cameraError && (
          <div className="mt-3 rounded-xl border border-danger/25 bg-danger/10 p-3 text-center text-sm text-danger">
            <p className="font-semibold">Enrollment Error</p>
            <p className="mt-0.5 text-xs">{cameraError}</p>
          </div>
        )}

        {/* Actions Footer */}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            className="flex-1 cursor-pointer rounded-xl border border-line bg-transparent px-4 py-2.5 text-sm font-semibold text-muted hover:text-fg transition"
          >
            Cancel
          </button>
          {cameraError && (
            <button
              type="button"
              onClick={restartEnrollment}
              className="flex-1 cursor-pointer rounded-xl border-0 bg-sky px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:brightness-105"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default FaceEnrollmentModal
