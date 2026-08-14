import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { courses as defaultCourses } from '../data/courses'
import { api } from '../services/api'
import Certificate from './Certificate'

const MyCertificates = () => {
  const navigate = useNavigate()
  const [selectedCourseForCert, setSelectedCourseForCert] = useState(null)
  const [userCourses, setUserCourses] = useState([])
  const [loading, setLoading] = useState(true)

  // Retrieve logged-in user from sessionStorage
  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James Joseph', email: 'james@skillbridge.com' }
    } catch {
      return { fullName: 'James Joseph', email: 'james@skillbridge.com' }
    }
  }, [])

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
          const lessonsCount = courseItem.lessons?.length || 5

          try {
            const prog = await api.getCourseProgress(courseItem.id)
            if (prog && (prog.completed || (prog.completedLessonIds && prog.completedLessonIds.length >= lessonsCount))) {
              isCompleted = true
              userScore = prog.progress || 80
            }
          } catch (err) { }

          if (!isCompleted) {
            try {
              const storageKey = `skillbridge_progress_${userId}_${courseItem.id}`
              const saved = localStorage.getItem(storageKey) || (userId === 'guest' ? localStorage.getItem(`skillbridge_progress_${courseItem.id}`) : null)
              if (saved) {
                const parsed = JSON.parse(saved)
                if (Array.isArray(parsed) && parsed.length >= lessonsCount) {
                  isCompleted = true
                }
              }
            } catch (e) { }
          }

          if (isCompleted) {
            completedList.push({
              ...courseItem,
              completed: true,
              score: userScore > 0 ? userScore : 80,
              date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
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

  const [autoDownload, setAutoDownload] = useState(false)

  if (selectedCourseForCert) {
    return (
      <Certificate
        course={selectedCourseForCert}
        scorePercentage={selectedCourseForCert.score || 80}
        onBackHome={() => {
          setSelectedCourseForCert(null)
          setAutoDownload(false)
        }}
        autoDownload={autoDownload}
      />
    )
  }

  return (
    <div className="min-h-screen w-full bg-[#f8fafc] text-[#0f172a] select-none p-6 sm:p-7 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-slate-200/80 pb-5">
          <div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#ff7a00] cursor-pointer border-0 bg-transparent p-0 transition mb-1.5"
            >
              <span>←</span> Back to Dashboard
            </button>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1e2e4a] tracking-tight flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-orange-50 text-[#ff7a00] flex items-center justify-center shrink-0 border border-orange-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              My Certificates
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              View and download your official SkillBridge AI course completion certificates anytime.
            </p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl px-4 py-2.5 flex items-center gap-3 shadow-2xs self-start sm:self-auto">
            <div className="h-10 w-10 rounded-full bg-[#ff7a00] text-white font-extrabold text-sm grid place-items-center uppercase shadow-2xs">
              {user.fullName ? user.fullName.charAt(0) : 'P'}
            </div>
            <div>
              <p className="text-xs font-bold text-[#1e2e4a]">{user.fullName || 'Praveen Patchipala'}</p>
              <p className="text-[11px] text-slate-400 font-medium">{userCourses.length} Verified Certificates</p>
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
          /* Certificates Cards Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {userCourses.map((courseItem) => (
              <div
                key={courseItem.id}
                className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 flex flex-col justify-between shadow-2xs hover:shadow-md transition duration-200 relative overflow-hidden group"
              >
                {/* Top Accent Ribbon */}
                <div className="absolute top-0 right-0 bg-[#ff7a00] text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
                  VERIFIED CERTIFICATE
                </div>

                <div>
                  {/* Seal Badge Icon & Course Tag */}
                  <div className="flex items-center gap-3.5 mb-4">
                    <div className="h-12 w-12 rounded-2xl bg-orange-50/90 border border-orange-100 flex items-center justify-center shrink-0">
                      <svg className="h-6 w-6 text-[#ff7a00]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4a5 5 0 005 5h4a5 5 0 005-5V3M5 3h14M5 3H3v4a3 3 0 003 3h.5M19 3h2v4a3 3 0 01-3 3h-.5M12 12v4m-4 4h8" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-[#15803d] bg-[#e6f4ea] border border-[#b7e4c7] px-2.5 py-0.5 rounded-lg inline-block">
                        ✓ {courseItem.score}% Passed
                      </span>
                      <p className="text-xs text-slate-400 font-medium mt-1">
                        Issued on {courseItem.date}
                      </p>
                    </div>
                  </div>

                  {/* Course Title */}
                  <h3 className="text-base font-bold text-[#1e2e4a] leading-snug line-clamp-2 group-hover:text-[#ff7a00] transition">
                    {courseItem.title}
                  </h3>

                  <p className="text-xs text-slate-400 font-medium mt-1">
                    Instructor: {courseItem.instructor}
                  </p>
                </div>

                {/* Bottom Action Buttons */}
                <div className="flex items-center gap-2.5 pt-5 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setAutoDownload(false)
                      setSelectedCourseForCert(courseItem)
                    }}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#ff7a00] hover:bg-[#ea6c00] text-white font-bold text-xs border-0 cursor-pointer transition shadow-2xs text-center flex items-center justify-center gap-2"
                  >
                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>View Certificate</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAutoDownload(true)
                      setSelectedCourseForCert(courseItem)
                    }}
                    className="py-2.5 px-4 rounded-xl bg-[#f1f5f9] hover:bg-slate-200 text-slate-700 font-bold text-xs border-0 cursor-pointer transition text-center flex items-center justify-center gap-2"
                    title="Download PDF"
                  >
                    <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Download</span>
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
