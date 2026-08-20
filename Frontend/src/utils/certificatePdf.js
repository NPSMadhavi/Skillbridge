import { jsPDF } from 'jspdf'
import logoUrl from '../assets/SkillBridge_AI.png'

/**
 * Helper to convert an image URL or import into a base64 Data URL.
 */
async function getImageDataUrl(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width || 400
        canvas.height = img.naturalHeight || img.height || 160
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Draws the official orange/gold ribbon seal badge in jsPDF.
 */
function drawSealBadge(pdf, cx, cy, radius = 13) {
  // Ribbon tails
  pdf.setFillColor(232, 108, 0) // #e86c00
  // Left ribbon
  pdf.triangle(cx - 8, cy + 8, cx - 14, cy + 24, cx - 3, cy + 18, 'F')
  // Right ribbon
  pdf.triangle(cx + 8, cy + 8, cx + 14, cy + 24, cx + 3, cy + 18, 'F')

  // Outer orange scalloped circle
  pdf.setFillColor(255, 122, 0) // #ff7a00
  pdf.circle(cx, cy, radius, 'F')

  // Middle white circle
  pdf.setFillColor(255, 255, 255)
  pdf.circle(cx, cy, radius - 2.5, 'F')

  // Inner orange circle
  pdf.setFillColor(255, 122, 0)
  pdf.circle(cx, cy, radius - 4.5, 'F')

  // Center star
  pdf.setFillColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(255, 255, 255)
  pdf.text('★', cx, cy + 1.8, { align: 'center' })
}

/**
 * Generates and downloads a high-definition, publication-ready vector PDF certificate.
 * Completely immune to CSS parsing bugs, 'oklch' errors, and responsive viewport distortions.
 *
 * @param {Object} params
 * @param {Object} params.course - Course data (with title)
 * @param {Object} params.user - User data (with fullName / name / firstName)
 * @param {number} [params.scorePercentage=80] - Score percentage
 * @param {string} [params.formattedDate] - Formatted date string
 * @param {string} [params.fileName] - Optional custom file name
 */
export async function downloadCertificateDirect({ course, user, scorePercentage = 80, formattedDate, fileName }) {
  const studentName = (
    user?.fullName ||
    user?.name ||
    (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : null) ||
    'James Joseph'
  )

  const courseTitle = course?.title || 'SkillBridge AI Course'
  const issueDate = formattedDate || new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  // Create A4 Landscape PDF (297 mm x 210 mm)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true
  })

  const pageWidth = 297
  const pageHeight = 210
  const centerX = pageWidth / 2

  // 1. Certificate Outer Borders
  // Outer Orange Border
  pdf.setDrawColor(255, 122, 0) // #ff7a00
  pdf.setLineWidth(1.4)
  pdf.roundedRect(12, 12, pageWidth - 24, pageHeight - 24, 7, 7, 'S')

  // Inner Thin Slate Border
  pdf.setDrawColor(226, 232, 240) // #e2e8f0
  pdf.setLineWidth(0.4)
  pdf.roundedRect(16, 16, pageWidth - 32, pageHeight - 32, 5, 5, 'S')

  // Decorative Corner Dots
  pdf.setFillColor(255, 122, 0)
  pdf.circle(20, 20, 1.2, 'F')
  pdf.circle(pageWidth - 20, 20, 1.2, 'F')
  pdf.circle(20, pageHeight - 20, 1.2, 'F')
  pdf.circle(pageWidth - 20, pageHeight - 20, 1.2, 'F')

  // 2. SkillBridge Logo
  try {
    const logoImg = await getImageDataUrl(logoUrl)
    if (logoImg?.dataUrl) {
      const logoW = 44
      const logoH = (logoImg.height * logoW) / logoImg.width
      pdf.addImage(logoImg.dataUrl, 'PNG', centerX - (logoW / 2), 22, logoW, logoH, undefined, 'FAST')
    }
  } catch (e) {
    // Fallback logo text if image loading fails
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(22)
    pdf.setTextColor(255, 122, 0)
    pdf.text('SKILLBRIDGE AI', centerX, 30, { align: 'center' })
  }

  // 3. Certificate Title Section with Accent Lines
  const lineY = 48
  pdf.setDrawColor(255, 122, 0)
  pdf.setLineWidth(0.8)
  pdf.line(centerX - 95, lineY, centerX - 42, lineY)
  pdf.line(centerX + 42, lineY, centerX + 95, lineY)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10.5)
  pdf.setTextColor(51, 65, 85) // #334155
  pdf.text('CERTIFICATE OF COMPLETION', centerX, lineY + 1.2, { align: 'center' })

  // 4. "This is to certify that"
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.setTextColor(100, 116, 139) // #64748b
  pdf.text('This is to certify that', centerX, 63, { align: 'center' })

  // 5. Student Name
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(26)
  pdf.setTextColor(30, 46, 74) // #1e2e4a
  pdf.text(studentName, centerX, 78, { align: 'center' })

  // Subtle accent line below name
  pdf.setDrawColor(255, 122, 0)
  pdf.setLineWidth(0.6)
  pdf.line(centerX - 35, 82, centerX + 35, 82)

  // 6. Course Completion Subtext
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.setTextColor(100, 116, 139)
  pdf.text('Has successfully completed the official course curriculum', centerX, 93, { align: 'center' })

  // 7. Course Name Pill Box
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13.5)
  const pillPaddingX = 14
  const textWidth = pdf.getTextWidth(courseTitle)
  const pillWidth = Math.min(220, Math.max(80, textWidth + (pillPaddingX * 2)))
  const pillHeight = 12
  const pillX = centerX - (pillWidth / 2)
  const pillY = 104

  // Pill Background
  pdf.setFillColor(219, 234, 254) // #dbeafe
  pdf.roundedRect(pillX, pillY, pillWidth, pillHeight, 3.5, 3.5, 'F')

  // Pill Text
  pdf.setTextColor(30, 58, 138) // #1e3a8a
  pdf.text(courseTitle, centerX, pillY + 8, { align: 'center' })

  // 8. Divider Line before bottom section
  pdf.setDrawColor(241, 245, 249) // #f1f5f9
  pdf.setLineWidth(0.5)
  pdf.line(26, 142, pageWidth - 26, 142)

  // 9. Bottom Left: Organization & Date
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(51, 65, 85) // #334155
  pdf.text('Skill bridge', 32, 156)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(148, 163, 184) // #94a3b8
  pdf.text(`Issued on ${issueDate}`, 32, 163)

  pdf.setFontSize(8)
  pdf.setTextColor(160, 175, 195)
  pdf.text('Verified Certificate ID: SB-' + Math.abs(hashCode(courseTitle + studentName)).toString(36).toUpperCase(), 32, 170)

  // 10. Bottom Right: Medal Seal Badge
  drawSealBadge(pdf, pageWidth - 48, 160, 14)

  // 11. Save PDF File
  const safeTitle = (courseTitle || 'SkillBridge_Course').replace(/[^a-zA-Z0-9]/g, '_')
  const finalFileName = fileName || `${safeTitle}_Certificate.pdf`

  pdf.save(finalFileName)
}

/**
 * Generate a consistent pseudo-hash for verification code.
 */
function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return hash
}

/**
 * Compatibility wrapper for DOM elements.
 * Uses direct vector generation with extracted or passed metadata for 100% reliability.
 */
export async function downloadCertificateFromElement(element, { courseTitle = 'SkillBridge Course', fileName } = {}) {
  // Extract user and score from session if possible
  let user = { fullName: 'James Joseph' }
  try {
    const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
    if (data?.user) user = data.user
  } catch {}

  return downloadCertificateDirect({
    course: { title: courseTitle },
    user,
    scorePercentage: 80,
    fileName
  })
}
