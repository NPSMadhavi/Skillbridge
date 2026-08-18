import { useMemo, useEffect, useState } from 'react'
import Certificate from './Certificate'
import { api } from '../services/api'

const fallbackQuestions = [
  {
    id: 1,
    prompt: 'What is the primary advantage of using machine learning over traditional programming?',
    options: [
      'It requires less computing power',
      'It can learn patterns from data without explicit programming',
      'It always produces perfect results',
      'It is easier to implement than regular code'
    ],
    answer: 1,
    explanation: 'Machine learning excels at learning patterns from data automatically, making it powerful for complex tasks where explicit rules are hard to define.'
  },
  {
    id: 2,
    prompt: 'Which step typically comes first in a machine learning workflow?',
    options: [
      'Model deployment and real-time monitoring',
      'Data collection, cleaning, and preparation',
      'Hyperparameter tuning and optimization',
      'Evaluating performance metrics'
    ],
    answer: 1,
    explanation: 'High quality data is essential before training any model. Data collection and preparation form the critical first foundation of any ML project.'
  },
  {
    id: 3,
    prompt: 'Which type of learning uses labeled training data?',
    options: [
      'Unsupervised Learning',
      'Reinforcement Learning',
      'Supervised Learning',
      'Deep Learning'
    ],
    answer: 2,
    explanation: 'Supervised learning uses labeled data where both inputs and expected target outputs are provided during training.'
  },
  {
    id: 4,
    prompt: 'Overfitting in machine learning models usually implies:',
    options: [
      'The model performs exceptionally well on unseen test data',
      'The model memorizes training data and generalizes poorly to new data',
      'The model requires zero evaluation metrics',
      'The model runs significantly faster on CPU'
    ],
    answer: 1,
    explanation: 'Overfitting happens when a model learns noise and details from the training set so closely that it negatively impacts performance on new unseen data.'
  },
  {
    id: 5,
    prompt: 'Which metric is commonly used for evaluating classification model performance?',
    options: [
      'Mean Squared Error (MSE)',
      'Accuracy score derived from confusion matrix',
      'Browser page load time',
      'Database index count'
    ],
    answer: 1,
    explanation: 'Classification models are evaluated using metrics like Accuracy, Precision, Recall, and F1-score derived from a confusion matrix.'
  },
]

const Assessment = ({ course, lessonTitle, quizQuestions, isFinalAssessment, onExit, onFinishAssessment }) => {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [isChecked, setIsChecked] = useState(false)
  const [score, setScore] = useState(0)
  const [userAnswers, setUserAnswers] = useState({})
  const [showCertificate, setShowCertificate] = useState(false)
  const [showFailedView, setShowFailedView] = useState(false)

  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James', role: 'STUDENT' }
    } catch {
      return { fullName: 'James', role: 'STUDENT' }
    }
  }, [])

  const userId = useMemo(() => {
    return user?.id || user?.finNumber || user?.email || 'guest';
  }, [user]);

  const activeQuestions = useMemo(() => {
    let source = []
    if (quizQuestions && Array.isArray(quizQuestions) && quizQuestions.length > 0) {
      source = quizQuestions
    } else if (course && course.isCustom && course.quiz && course.quiz.length > 0) {
      source = course.quiz
    } else {
      source = fallbackQuestions
    }

    const TARGET_DISTRIBUTION = [1, 3, 2, 0, 3] // Option B, Option D, Option C, Option A, Option D

    const mapped = source.map((q, idx) => {
      const origCorrectIdx = q.answerIndex !== undefined ? q.answerIndex : q.answer !== undefined ? q.answer : 0
      let opts = Array.isArray(q.options) && q.options.length >= 2 ? [...q.options] : ['Option A', 'Option B', 'Option C', 'Option D']

      const correctText = opts[origCorrectIdx] || opts[0]

      // Balance answer choices across A, B, C, D so correct answer is not stuck on Option A
      const targetIdx = TARGET_DISTRIBUTION[idx % TARGET_DISTRIBUTION.length] % opts.length
      if (origCorrectIdx !== targetIdx && targetIdx < opts.length) {
        const temp = opts[targetIdx]
        opts[targetIdx] = correctText
        opts[origCorrectIdx] = temp
      }
      const finalAnswerIdx = opts.indexOf(correctText)

      let explanationText = q.explanation
      if (!explanationText || explanationText.length < 5) {
        if (source === fallbackQuestions) {
          explanationText = fallbackQuestions[idx % fallbackQuestions.length]?.explanation
        } else {
          explanationText = correctText
            ? `"${correctText}" is correct because it directly satisfies the requirement described in this question.`
            : 'Review the correct answer highlighted above to strengthen your understanding.'
        }
      }

      return {
        id: idx + 1,
        prompt: q.question || q.prompt || `Question ${idx + 1}`,
        options: opts,
        answer: finalAnswerIdx >= 0 ? finalAnswerIdx : targetIdx,
        explanation: explanationText
      }
    })

    // Guarantee EXACTLY 5 questions
    if (mapped.length >= 5) {
      return mapped.slice(0, 5)
    } else {
      const extraNeeded = 5 - mapped.length
      const padding = fallbackQuestions.slice(0, extraNeeded).map((q, idx) => ({
        ...q,
        id: mapped.length + idx + 1
      }))
      return [...mapped, ...padding]
    }
  }, [quizQuestions, course])

  const question = activeQuestions[index]

  const handleFinish = () => {
    if (onFinishAssessment) {
      onFinishAssessment()
    } else {
      onExit?.()
    }
  }

  const handleActionClick = () => {
    if (!isChecked) {
      // Step 1: Check answer for current question
      if (selected === null) return
      const isCorrect = selected === question.answer
      const updatedScore = score + (isCorrect ? 1 : 0)
      if (isCorrect) {
        setScore(updatedScore)
      }
      setUserAnswers(prev => ({ ...prev, [index]: selected }))
      setIsChecked(true)
    } else {
      // Step 2: Move to next question or evaluate final course completion
      if (index === activeQuestions.length - 1) {
        const isLastLesson = Boolean(
          isFinalAssessment ||
          !course?.lessons ||
          lessonTitle === course?.lessons[course.lessons.length - 1]?.title
        )

        if (isLastLesson) {
          const passThreshold = 3 // 60% passing mark
          if (score >= passThreshold) {
            if (course?.id) {
              const allLessonIds = course.lessons ? course.lessons.map(l => String(l.id)) : ['1', '2', '3', '4', '5'];
              try {
                localStorage.setItem(`skillbridge_progress_${userId}_${course.id}`, JSON.stringify(allLessonIds));
              } catch (e) { }
              api.saveCourseProgress(course.id, {
                completed: true,
                progress: 100,
                completedLessonIds: allLessonIds
              }).catch(e => console.warn('Failed to save completion:', e));
            }
            setShowCertificate(true)
          } else {
            setShowFailedView(true)
          }
        } else {
          handleFinish()
        }
      } else {
        setIndex(prev => prev + 1)
        setSelected(null)
        setIsChecked(false)
      }
    }
  }

  // Calculate percentage score for certificate
  const scorePercentage = useMemo(() => {
    return Math.round((score / Math.max(1, activeQuestions.length)) * 100)
  }, [score, activeQuestions.length])

  // If user completed final assessment and passed, render official Certificate of Completion!
  if (showCertificate) {
    return (
      <Certificate
        course={course}
        scorePercentage={scorePercentage}
        onBackHome={() => {
          handleFinish()
        }}
      />
    )
  }

  // If user took final assessment but scored below 60%, render Retake prompt
  if (showFailedView) {
    return (
      <div className="min-h-screen w-full bg-[#f4f7fc] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 max-w-lg w-full text-center shadow-sm">
          <span className="text-4xl">⚠️</span>
          <h2 className="text-xl font-bold text-[#1e2e4a] mt-3">Final Assessment Not Passed</h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            You scored <span className="font-bold text-amber-600">{scorePercentage}%</span> ({score}/5). You need at least <span className="font-bold text-emerald-600">60%</span> to pass and earn your course certificate.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => {
                setIndex(0)
                setSelected(null)
                setIsChecked(false)
                setScore(0)
                setUserAnswers({})
                setShowFailedView(false)
              }}
              className="px-6 py-2.5 rounded-xl bg-[#ff7a00] text-white font-bold text-xs border-0 cursor-pointer shadow-xs hover:bg-[#ea6c00]"
            >
              🔄 Retake Assessment
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="px-6 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs cursor-pointer hover:bg-slate-50"
            >
              ← Back to Course
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[#f4f7fc] text-[#0f172a] select-none flex flex-col font-sans px-4 py-3 sm:px-6 sm:py-4">
      {/* Top Left Header with Back Button */}
      <div className="shrink-0 w-full mb-2">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#1e293b] hover:text-[#0f172a] transition border-0 bg-transparent p-0 cursor-pointer"
        >
          <span className="text-base">←</span> Back
        </button>
      </div>

      {/* Main Container */}
      <main className="w-full flex-1 flex justify-center items-start overflow-visible">
        <div className="bg-white rounded-[20px] sm:rounded-[24px] border border-slate-200/80 shadow-xs w-full p-4 sm:p-6 lg:p-8 flex flex-col justify-between min-h-0 overflow-y-auto">

          {/* Header & Title Section */}
          <div className="shrink-0 text-center">
            <h1 className="text-xl sm:text-2xl font-bold text-[#1e2e4a] tracking-tight">
              Course Assessment
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              {course?.title || lessonTitle || 'Full Stack web development'}
            </p>

            {/* Segmented 5-Step Progress Bar */}
            <div className="grid grid-cols-5 gap-3 max-w-md mx-auto mt-4 mb-2 w-full">
              {activeQuestions.map((q, i) => {
                let stepColor = 'bg-slate-200/90'
                const isStepChecked = i < index || (i === index && isChecked)

                if (isStepChecked) {
                  stepColor = 'bg-emerald-500'
                } else if (i === index) {
                  stepColor = 'bg-[#ff7a00]'
                }

                return (
                  <div
                    key={q.id}
                    className={`h-2 rounded-full transition-all duration-300 ${stepColor}`}
                  />
                )
              })}
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col justify-between my-1 overflow-y-auto pr-0.5">
            {/* Question Header & Prompt */}
            <div className="shrink-0 mt-1">
              <p className="text-xs sm:text-sm text-slate-500 font-semibold">
                Questions {index + 1} of {activeQuestions.length}
              </p>
              <h2 className="text-base sm:text-lg lg:text-xl font-bold text-[#0f172a] mt-1 leading-snug">
                {question?.prompt}
              </h2>
            </div>

            {/* Options List */}
            <div className="flex-1 min-h-0 space-y-2.5 my-2 pr-0.5">
              {question?.options.map((optionText, optionIndex) => {
                const isSelected = selected === optionIndex
                const isCorrectOption = optionIndex === question.answer
                const isUserWrongChoice = isChecked && isSelected && !isCorrectOption

                // Card visual style determination
                let cardStyle = 'bg-white border-slate-200/90 hover:border-slate-300 text-[#0f172a] font-semibold'
                let badgeStyle = 'bg-slate-100 text-slate-800 font-bold'
                let badgeIcon = String.fromCharCode(65 + optionIndex)

                if (isChecked) {
                  if (isCorrectOption) {
                    cardStyle = 'bg-emerald-50/60 border-2 border-emerald-500 text-slate-900 font-medium shadow-2xs'
                    badgeStyle = 'bg-emerald-500 text-white font-bold'
                    badgeIcon = (
                      <svg className="w-4 h-4 fill-none stroke-current stroke-[3]" viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )
                  } else if (isUserWrongChoice) {
                    cardStyle = 'bg-rose-50/60 border-2 border-rose-500 text-slate-900 font-medium shadow-2xs'
                    badgeStyle = 'bg-rose-500 text-white font-bold'
                    badgeIcon = (
                      <svg className="w-4 h-4 fill-none stroke-current stroke-[3]" viewBox="0 0 24 24">
                        <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )
                  } else {
                    cardStyle = 'bg-white border-slate-200 text-slate-400 opacity-60'
                    badgeStyle = 'bg-slate-100 text-slate-400 font-bold'
                  }
                } else if (isSelected) {
                  cardStyle = 'bg-[#fff8f2] border-2 border-[#ff7a00] text-[#1e2e4a] font-medium shadow-2xs'
                  badgeStyle = 'bg-[#ff7a00] text-white font-bold'
                }

                return (
                  <button
                    key={optionIndex}
                    type="button"
                    disabled={isChecked}
                    onClick={() => !isChecked && setSelected(optionIndex)}
                    className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl border text-left transition cursor-pointer text-xs sm:text-sm ${cardStyle}`}
                  >
                    {/* Left Badge Circle (A, B, C, D or ✓ or ✕) */}
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition text-xs ${badgeStyle}`}>
                      {badgeIcon}
                    </div>

                    <span className="leading-relaxed flex-1">{optionText}</span>
                  </button>
                )
              })}

              {/* AI Explanation Feedback Box (Renders when user checks answer) */}
              {isChecked && (
                <div className={`p-4 rounded-2xl text-left border animate-fade-in ${selected === question.answer
                    ? 'bg-emerald-50/90 border-emerald-200/80 text-emerald-900'
                    : 'bg-rose-50/90 border-rose-200/80 text-rose-900'
                  }`}>
                  <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold">
                    <span className="text-sm">🤖</span>
                    <span className={selected === question.answer ? 'text-emerald-700' : 'text-rose-700'}>
                      {selected === question.answer ? 'Correct! 🎉' : "Not quite. Here's why:"}
                    </span>
                  </div>
                  <p className={`text-xs sm:text-sm font-medium mt-1 leading-relaxed ${selected === question.answer ? 'text-emerald-800' : 'text-rose-800'
                    }`}>
                    {question.explanation}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Action Button */}
            <div className="shrink-0 text-center pt-2">
              <button
                type="button"
                onClick={handleActionClick}
                disabled={!isChecked && selected === null}
                className="cursor-pointer rounded-2xl bg-[#ff7a00] hover:bg-[#ea6c00] px-12 py-3.5 text-xs sm:text-sm font-bold text-white border-0 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {!isChecked
                  ? 'Check answer'
                  : index === activeQuestions.length - 1
                    ? 'Finish Assessment >'
                    : 'Next Question >'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Assessment
