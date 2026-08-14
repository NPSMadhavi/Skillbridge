import { useMemo, useState, useEffect } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import logo from '../assets/SkillBridge_AI.png'

const Certificate = ({ course, scorePercentage = 80, onBackHome, autoDownload = false }) => {
  const [downloading, setDownloading] = useState(false)

  // Retrieve user full name from sessionStorage
  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James Joseph', firstName: 'James' }
    } catch {
      return { fullName: 'James Joseph', firstName: 'James' }
    }
  }, [])

  const firstName = useMemo(() => {
    if (user.fullName) {
      return user.fullName.trim().split(' ')[0]
    }
    return user.firstName || 'James'
  }, [user])

  const formattedDate = useMemo(() => {
    const today = new Date()
    return today.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }, [])

  const handleDownloadPDF = async () => {
    const element = document.getElementById('printable-certificate')
    if (!element) return

    setDownloading(true)
    try {
      // Convert certificate DOM element to high-res canvas
      const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      })

      const imgData = canvas.toDataURL('image/png', 1.0)

      // Create landscape A4 PDF document
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      })

      const pdfWidth = pdf.internal.pageSize.getWidth()   // ~297 mm
      const pdfHeight = pdf.internal.pageSize.getHeight() // ~210 mm

      const margin = 10 // 10mm margin
      const contentWidth = pdfWidth - (margin * 2)
      const contentHeight = (canvas.height * contentWidth) / canvas.width

      const yOffset = Math.max(margin, (pdfHeight - contentHeight) / 2)

      pdf.addImage(imgData, 'PNG', margin, yOffset, contentWidth, contentHeight)

      const courseTitle = course?.title || 'SkillBridge_Course'
      const fileName = `${courseTitle.replace(/[^a-zA-Z0-9]/g, '_')}_Certificate.pdf`

      // Instantly save/download the PDF file directly to user's device!
      pdf.save(fileName)
    } catch (err) {
      console.error('Direct PDF download error:', err)
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    if (autoDownload) {
      const timer = setTimeout(() => {
        handleDownloadPDF()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [autoDownload])

  return (
    <div className="min-h-screen sm:h-screen sm:max-h-screen w-full bg-[#f8fafc] text-[#0f172a] select-none flex flex-col items-center justify-between p-3 sm:p-4 font-sans overflow-y-auto sm:overflow-hidden">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-certificate, #printable-certificate * {
            visibility: visible;
          }
          #printable-certificate {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 30px !important;
            border: 2px solid #ff7a00 !important;
            box-shadow: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Top Congratulations Heading */}
      <div className="no-print text-center mb-1 sm:mb-2">
        <h1 className="text-lg sm:text-xl font-bold text-[#1e2e4a] tracking-tight">
          Congratulations, {firstName} !
        </h1>
        <p className="text-xs text-slate-500 font-medium mt-0.5">
          You&apos;ve successfully completed the course with a score of {scorePercentage}%
        </p>
      </div>

      {/* Main Printable Certificate Card Container */}
      <div
        id="printable-certificate"
        className="bg-white rounded-[24px] border-2 border-[#ff7a00] p-4 sm:p-6 lg:p-8 shadow-sm max-w-2xl w-full text-center relative overflow-hidden my-1 flex-1 flex flex-col justify-between max-h-[500px]"
      >
        {/* SkillBridge Header Logo */}
        <div className="flex justify-center mb-2 sm:mb-3">
          <img src={logo} alt="SkillBridge AI" className="h-12 sm:h-16 lg:h-20 object-contain" />
        </div>

        {/* Certificate Title Line */}
        <div className="flex items-center justify-center gap-3 my-2">
          <div className="h-[1px] bg-gradient-to-r from-transparent via-[#ff7a00] to-transparent w-20 sm:w-28" />
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-700 tracking-[0.2em] uppercase">
            CERTIFICATE OF COMPLETION
          </span>
          <div className="h-[1px] bg-gradient-to-r from-transparent via-[#ff7a00] to-transparent w-20 sm:w-28" />
        </div>

        {/* Certification Text */}
        <p className="text-xs text-slate-500 font-medium mt-2">
          This is to certify that
        </p>

        {/* Full Name */}
        <h2 className="text-xl sm:text-2xl font-bold text-[#1e2e4a] tracking-tight my-1">
          {user.fullName || 'James Joseph'}
        </h2>

        {/* Course Completion Subtext & Score */}
        <p className="text-xs text-slate-500 font-medium mb-2">
          Has successfully completed the course with a score of <span className="font-extrabold text-[#ff7a00] text-sm">{scorePercentage}%</span>
        </p>

        {/* Course Name Pill */}
        <div className="bg-[#dbeafe] text-[#1e3a8a] text-xs sm:text-sm font-bold py-2.5 px-6 rounded-xl max-w-md mx-auto my-3 shadow-2xs">
          {course?.title || 'Full Stack Web Development'}
        </div>

        {/* Bottom Section: Organization Date & Ribbon Medal Seal */}
        <div className="flex items-center justify-between pt-6 mt-4 border-t border-slate-100 px-4 sm:px-10">
          {/* Left: Organization & Date */}
          <div className="flex flex-col text-left">
            <p className="text-xs sm:text-sm font-bold text-slate-700">Skill bridge</p>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">{formattedDate}</p>
          </div>

          {/* Right: Orange Ribbon Medal Seal Badge */}
          <div className="flex items-center justify-center">
            <div className="relative flex items-center justify-center">
              <svg className="w-12 h-12 text-[#ff7a00]" viewBox="0 0 64 64" fill="currentColor">
                {/* Ribbon Tails */}
                <path d="M22 42 L16 60 L26 54 L32 60 L28 42 Z" fill="#e86c00" />
                <path d="M42 42 L48 60 L38 54 L32 60 L36 42 Z" fill="#e86c00" />
                {/* Outer Star Ribbon Seal */}
                <circle cx="32" cy="28" r="22" fill="#ff7a00" />
                <circle cx="32" cy="28" r="17" fill="#ffffff" />
                {/* Inner 6-point Star */}
                <polygon points="32,15 35,22 43,23 37,29 39,37 32,32 25,37 27,29 21,23 29,22" fill="#ff7a00" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="no-print flex flex-wrap items-center justify-center gap-3 mt-2 sm:mt-3">
        <button
          type="button"
          disabled={downloading}
          onClick={handleDownloadPDF}
          className="cursor-pointer rounded-xl bg-[#ff7a00] hover:bg-[#ea6c00] px-6 py-2.5 text-xs sm:text-sm font-bold text-white border-0 transition shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
        >
          {downloading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          {downloading ? 'Generating PDF...' : 'Download'}
        </button>

        <button
          type="button"
          onClick={onBackHome}
          className="cursor-pointer rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-6 py-2.5 text-xs sm:text-sm font-bold transition flex items-center gap-2 shadow-2xs"
        >
          <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </button>
      </div>
    </div>
  )
}

export default Certificate
