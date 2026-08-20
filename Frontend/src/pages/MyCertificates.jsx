import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { courses as defaultCourses } from '../data/courses'
import { api } from '../services/api'
import Certificate from './Certificate'
import { downloadCertificateDirect } from '../utils/certificatePdf'

const MyCertificates = () => {
  const navigate = useNavigate()
  const [selectedCourseForCert, setSelectedCourseForCert] = useState(null)
  const [userCourses, setUserCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingCourseId, setDownloadingCourseId] = useState(null)

  // Retrieve logged-in user from sessionStorage
  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James Joseph', email: 'james@skillbridge.com' }
    } catch {
      return { fullName: 'James Joseph', email: 'james@skillbridge.com' }
    }
  }, [])

  const userDisplayName = useMemo(() => {
    return user?.fullName || user?.name || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'James Joseph')
  }, [user])

  // Load ONLY actually completed courses and their verified progress
  useEffect(() => {
    let isMounted = true

    const checkRealCompletedCourses = async () => {
      try {
        let dbCourses = []
        try {
          const res = await api.getCourses()
          if (Array.isArray(res)) dbCourses = res
        } catch (e) {
          console.warn('Failed to fetch DB courses for certificates:', e)
        }

        const allCourses = [
          ...dbCourses.map(c => ({
            id: c.id,
            title: c.title,
            instructor: 'ARIA AI Tutor',
            isCustom: true
          })),
          ...defaultCourses.map(c => ({
            id: c.id,
            title: c.title,
            instructor: c.instructor || 'Dr Shaan Sha',
            isCustom: false,
            lessons: c.lessons
          }))
        ]

        const userId = user?.id || user?.finNumber || user?.email || 'guest'
        const completedList = []

        for (const courseItem of allCourses) {
          let isCompleted = false
          let userScore = 80
          let completedAtDate = null

          // Only query backend API for custom courses that the student was assigned to
          if (courseItem.isCustom) {
            try {
              const prog = await api.getCourseProgress(courseItem.id)
              if (prog && (prog.completed || (prog.completedLessonIds && prog.completedLessonIds.length >= lessonsCount))) {
                isCompleted = true
                userScore = prog.progress || 80
                if (prog.updatedAt) {
                  completedAtDate = new Date(prog.updatedAt)
                } else if (prog.startedAt) {
                  completedAtDate = new Date(prog.startedAt)
                }
              }
            } catch (err) { }
          }

          if (!isCompleted) {
            try {
              const storageKey = `skillbridge_progress_${userId}_${courseItem.id}`
              const saved = localStorage.getItem(storageKey) || (userId === 'guest' ? localStorage.getItem(`skillbridge_progress_${courseItem.id}`) : null)
              if (saved) {
                const parsed = JSON.parse(saved)
                if (Array.isArray(parsed) && parsed.length >= lessonsCount) {
                  isCompleted = true
                  const storedDate = localStorage.getItem(`skillbridge_completed_date_${userId}_${courseItem.id}`) ||
                    localStorage.getItem(`skillbridge_completed_date_${courseItem.id}`)
                  if (storedDate) {
                    completedAtDate = new Date(storedDate)
                  }
                }
              }
            } catch (e) { }
          }

          if (isCompleted) {
            const finalDateObj = (completedAtDate && !isNaN(completedAtDate.getTime())) ? completedAtDate : new Date()
            const formattedCompletedDate = finalDateObj.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })

            completedList.push({
              ...courseItem,
              completed: true,
              score: userScore > 0 ? userScore : 80,
              date: formattedCompletedDate,
              rawCompletedAt: finalDateObj.toISOString()
            })
          }
        }

        if (isMounted) {
          setUserCourses(completedList)
          setLoading(false)
        }
      } catch (err) {
        if (isMounted) {
          setUserCourses([])
          setLoading(false)
        }
      }
    }

    checkRealCompletedCourses()

    return () => { isMounted = false }
  }, [user])

  const handleDownloadDirect = async (courseItem) => {
    if (downloadingCourseId) return
    setDownloadingCourseId(courseItem.id)
    try {
      await downloadCertificateDirect({
        course: courseItem,
        user,
        scorePercentage: courseItem.score || 80,
        formattedDate: courseItem.date
      })
    } catch (err) {
      console.error('Direct certificate download failed:', err)
      // Fallback: open certificate view
      setSelectedCourseForCert(courseItem)
    } finally {
      setDownloadingCourseId(null)
    }
  }

  if (selectedCourseForCert) {
    return (
      <Certificate
        course={selectedCourseForCert}
        scorePercentage={selectedCourseForCert.score || 80}
        onBackHome={() => {
          setSelectedCourseForCert(null)
        }}
        autoDownload={false}
      />
    )
  }

  return (
    <div className="min-h-screen w-full bg-[#f8fafc] text-[#0f172a] select-none p-6 sm:p-7 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-200">
          <div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-orange cursor-pointer border-0 bg-transparent p-0 transition mb-1"
            >
              <span>←</span> Back to Dashboard
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-orange-50 text-orange flex items-center justify-center shrink-0 border border-orange-100">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              My Certificates
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              View and download your official SkillBridge AI course completion certificates anytime.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-2.5 shadow-2xs self-start sm:self-auto">
            <div className="h-7 w-7 rounded-full bg-orange text-white font-bold text-xs grid place-items-center uppercase shrink-0">
              {userDisplayName ? userDisplayName.charAt(0) : 'S'}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800 leading-tight">{userDisplayName}</p>
              <p className="text-[10px] text-slate-400 font-medium">
                {userCourses.length} {userCourses.length === 1 ? 'Verified Certificate' : 'Verified Certificates'}
              </p>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin h-8 w-8 border-4 border-[#ff7a00] border-t-transparent rounded-full mb-3" />
            <p className="text-xs text-slate-500 font-medium">Loading your earned certificates...</p>
          </div>
        ) : userCourses.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-12 shadow-xs">
            <div className="h-14 w-14 rounded-2xl bg-orange-50 text-[#ff7a00] border border-orange-100 flex items-center justify-center mx-auto mb-3">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-[#1e2e4a] mt-3">No Certificates Earned Yet</h3>
            <p className="text-xs text-slate-500 font-medium mt-1.5 leading-relaxed">
              Complete any course and pass the final chapter assessment with 60%+ to unlock your official certificate!
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-5 px-6 py-2.5 rounded-xl bg-[#ff7a00] text-white text-xs font-bold border-0 cursor-pointer shadow-xs hover:bg-[#ea6c00]"
            >
              Explore Courses →
            </button>
          </div>
        ) : (
          /* Compact & Clean Certificates Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {userCourses.map((courseItem) => (
              <div
                key={courseItem.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-col justify-between shadow-[0_4px_16px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_25px_rgba(15,23,42,0.1)] hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200 group"
              >
                <div>
                  {/* Status & Date */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Completed
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium truncate">
                      {courseItem.date}
                    </span>
                  </div>

                  {/* Course Title */}
                  <h3 className="text-xs sm:text-sm font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-orange transition">
                    {courseItem.title}
                  </h3>
                </div>

                {/* Compact Actions */}
                <div className="flex items-center gap-2 pt-3 mt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseForCert(courseItem)
                    }}
                    className="flex-1 py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium text-[11px] transition cursor-pointer flex items-center justify-center gap-1"
                  >
                    <svg className="h-3 w-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>View</span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingCourseId === courseItem.id}
                    onClick={() => handleDownloadDirect(courseItem)}
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-orange hover:brightness-105 text-white font-medium text-[11px] border-0 transition cursor-pointer flex items-center justify-center gap-1 shadow-2xs disabled:opacity-60 disabled:cursor-wait"
                  >
                    {downloadingCourseId === courseItem.id ? (
                      <>
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span>Download</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyCertificates
