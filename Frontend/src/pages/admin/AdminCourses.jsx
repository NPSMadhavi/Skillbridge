import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'react-toastify'
import { api } from '../../services/api'

const AdminCourses = () => {
  const [coursesList, setCoursesList] = useState([])
  const [loading, setLoading] = useState(true)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(6)

  // Creation modal state
  const [showModal, setShowModal] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)

  // Generation loader state
  const [isGenerating, setIsGenerating] = useState(false)
  const [stage, setStage] = useState('') // uploading | parsing | structuring | finalizing
  const [errorMsg, setErrorMsg] = useState('')

  // Edit modal state
  const [editingCourse, setEditingCourse] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editFile, setEditFile] = useState(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editErrorMsg, setEditErrorMsg] = useState('')

  // View details modal state
  const [viewingCourse, setViewingCourse] = useState(null)

  const totalPages = Math.max(1, Math.ceil(coursesList.length / pageSize))

  const paginatedCourses = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return coursesList.slice(start, start + pageSize)
  }, [coursesList, currentPage, pageSize])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [totalPages, currentPage])

  const fetchCourses = async () => {
    try {
      setLoading(true)
      const coursesData = await api.getCourses()
      setCoursesList(coursesData || [])
    } catch (err) {
      console.error('Failed to load courses:', err)
      toast.error('Failed to load courses list.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCourses()
  }, [])


  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 30 * 1024 * 1024) {
        const msg = 'File size exceeds 30MB limit. Please upload a smaller file.'
        setErrorMsg(msg)
        toast.warn(msg)
        setSelectedFile(null)
      } else {
        setErrorMsg('')
        setSelectedFile(file)
      }
    }
  }

  const handlePublish = async (e) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) {
      const msg = 'Course title and description are required.'
      setErrorMsg(msg)
      toast.warn(msg)
      return
    }

    if (!selectedFile) {
      const msg = 'Please select a course document to upload.'
      setErrorMsg(msg)
      toast.warn(msg)
      return
    }

    setIsGenerating(true)
    setErrorMsg('')

    setStage('uploading')
    const t1 = setTimeout(() => setStage('parsing'), 1800)
    const t2 = setTimeout(() => setStage('structuring'), 4200)
    const t3 = setTimeout(() => setStage('finalizing'), 7500)

    try {
      await api.adminUploadCourse(title.trim(), description.trim(), selectedFile)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      setIsGenerating(false)
      setShowModal(false)
      resetCreateForm()
      toast.success('Course created and AI curriculum generated successfully!')
      fetchCourses()
    } catch (err) {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      console.error('Course publish error:', err)
      const msg = err.message || 'An error occurred during course generation.'
      setErrorMsg(msg)
      toast.error(msg)
      setIsGenerating(false)
    }
  }

  const resetCreateForm = () => {
    setTitle('')
    setDescription('')
    setSelectedFile(null)
    setErrorMsg('')
  }

  const handleOpenEdit = (course) => {
    setEditingCourse(course)
    setEditTitle(course.title)
    setEditDescription(course.description)
    setEditFile(null)
    setEditErrorMsg('')
  }

  const handleEditFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 30 * 1024 * 1024) {
        const msg = 'File size exceeds 30MB limit. Please upload a smaller file.'
        setEditErrorMsg(msg)
        toast.warn(msg)
        setEditFile(null)
      } else {
        setEditErrorMsg('')
        setEditFile(file)
      }
    }
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editTitle.trim() || !editDescription.trim()) {
      const msg = 'Title and description cannot be empty.'
      setEditErrorMsg(msg)
      toast.warn(msg)
      return
    }

    setIsUpdating(true)
    setEditErrorMsg('')
    try {
      if (editFile) {
        const formData = new FormData()
        formData.append('title', editTitle.trim())
        formData.append('description', editDescription.trim())
        formData.append('file', editFile)
        await api.adminUpdateCourse(editingCourse.id, formData)
      } else {
        await api.adminUpdateCourse(editingCourse.id, {
          title: editTitle.trim(),
          description: editDescription.trim(),
        })
      }
      setEditingCourse(null)
      setEditFile(null)
      toast.success('Course updated successfully!')
      fetchCourses()
    } catch (err) {
      console.error('Update course error:', err)
      const msg = err.message || 'Failed to update course.'
      setEditErrorMsg(msg)
      toast.error(msg)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = async (courseId) => {
    if (!window.confirm('Are you sure you want to delete this course module? This action cannot be undone.')) {
      return
    }
    try {
      await api.adminDeleteCourse(courseId)
      toast.success('Course deleted successfully.')
      fetchCourses()
    } catch (err) {
      console.error('Delete course error:', err)
      toast.error(err.message || 'Failed to delete course.')
    }
  }

  return (
    <div className="animate-rise-in space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Course Manager
          </h1>
          <p className="mt-1 text-sm text-muted">Create, view, update, and delete course modules.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetCreateForm()
            setShowModal(true)
          }}
          className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-orange px-4.5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(240,106,0,0.22)] transition hover:brightness-105 border-0"
        >
          + Create New Course
        </button>
      </div>

      {/* Catalog Grid */}
      {loading ? (
        <div className="py-20 text-center text-muted">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-orange/20 border-t-orange mb-3" />
          Loading course catalog...
        </div>
      ) : coursesList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel px-6 py-12 text-center shadow-sm">
          <span className="text-4xl">📚</span>
          <h3 className="mt-4 font-display text-lg font-bold text-fg">No courses published</h3>
          <p className="mt-1 text-sm text-muted max-w-md mx-auto">
            Get started by uploading a course document (PDF, Word, TXT, etc.) to automatically generate a course module.
          </p>
          <button
            type="button"
            onClick={() => {
              resetCreateForm()
              setShowModal(true)
            }}
            className="mt-5 inline-flex cursor-pointer items-center justify-center rounded-xl bg-orange px-4 py-2.5 text-xs font-bold text-white border-0 hover:brightness-105"
          >
            Create your first course
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {paginatedCourses.map((course) => {
              const curriculumData = typeof course.curriculum === 'string'
                ? JSON.parse(course.curriculum)
                : (course.curriculum || {})
              const lessons = curriculumData.lessons || []
              const lessonCount = lessons.length || (curriculumData.curriculum?.length ? curriculumData.curriculum.length * 4 : 5)

              return (
                <article
                  key={course.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-sm transition hover:shadow-md"
                >
                  <div className="h-32 bg-gradient-to-br from-navy to-sky relative p-5 flex flex-col justify-end text-white">
                    <div className="absolute top-4 right-4 flex items-center gap-1.5">
                      <span className="rounded-full bg-white/15 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
                        {lessonCount} Modules
                      </span>
                    </div>
                    <h3 className="font-display text-base font-bold truncate">{course.title}</h3>
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <p className="text-xs text-muted leading-relaxed flex-1 line-clamp-3">
                      {course.description}
                    </p>
                    <div className="mt-4 border-t border-line pt-4 flex items-center justify-between text-xs">
                      <span className="text-muted truncate max-w-[110px]" title={course.fileName}>
                        📄 {course.fileName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingCourse(course)}
                          className="cursor-pointer rounded-lg bg-ink px-2.5 py-1 text-xs font-semibold text-sky hover:border-sky/40 border border-line transition"
                          title="View curriculum details"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(course)}
                          className="cursor-pointer rounded-lg bg-ink px-2.5 py-1 text-xs font-semibold text-fg hover:border-sky/40 border border-line transition"
                          title="Edit course title & description"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(course.id)}
                          className="cursor-pointer font-bold text-danger hover:underline border-0 bg-transparent p-0 text-xs ml-1"
                          title="Delete course"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          {coursesList.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3 sm:px-5 text-xs text-muted shadow-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Courses per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-line bg-ink px-2 py-1 text-xs text-fg font-medium outline-none focus:border-sky cursor-pointer"
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                </select>
                <span className="hidden sm:inline text-muted/60">|</span>
                <span>
                  Showing <span className="font-semibold text-fg">{coursesList.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{' '}
                  <span className="font-semibold text-fg">{Math.min(currentPage * pageSize, coursesList.length)}</span> of{' '}
                  <span className="font-semibold text-fg">{coursesList.length}</span> course{coursesList.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line bg-ink text-xs font-semibold text-fg hover:border-sky/40 hover:text-sky transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  ← Prev
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1]
                      const showEllipsis = prev && p - prev > 1

                      return (
                        <span key={p} className="flex items-center">
                          {showEllipsis && <span className="px-1 text-muted">…</span>}
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`h-7 min-w-7 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                              currentPage === p
                                ? 'bg-sky text-white shadow-xs font-bold'
                                : 'border border-line bg-ink text-muted hover:text-fg hover:border-sky/30'
                            }`}
                          >
                            {p}
                          </button>
                        </span>
                      )
                    })}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line bg-ink text-xs font-semibold text-fg hover:border-sky/40 hover:text-sky transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}


      {/* Creation Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-line bg-panel p-6 shadow-2xl animate-rise-in text-fg my-auto">
            {!isGenerating ? (
              <form onSubmit={handlePublish} className="space-y-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <h2 className="font-display text-lg font-bold text-fg">Create New Course</h2>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="cursor-pointer text-muted hover:text-fg border-0 bg-transparent text-lg font-semibold"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-1">
                  <label htmlFor="course-title" className="text-xs font-semibold text-muted">Course Name</label>
                  <input
                    id="course-title"
                    type="text"
                    placeholder="e.g. Workplace Safety & Operational Standards"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-fg placeholder-muted focus:border-orange focus:outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="course-desc" className="text-xs font-semibold text-muted">Course Description</label>
                  <textarea
                    id="course-desc"
                    placeholder="Summarize what this course teaches learners..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows="3"
                    className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-fg placeholder-muted focus:border-orange focus:outline-none resize-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted">Course Document</label>
                  <label className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition p-6 text-center ${
                    selectedFile
                      ? 'border-orange bg-orange/5'
                      : 'border-line bg-ink/50 hover:border-orange/50 hover:bg-ink'
                  }`}>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.text,.md,.markdown,.rtf,.html,.htm,.csv,.pptx,.ppt,.json"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <span className="text-3xl">
                      {selectedFile ? (
                        selectedFile.name.endsWith('.pdf') ? '📄' :
                        selectedFile.name.match(/\.(docx?|doc)$/i) ? '📝' :
                        selectedFile.name.match(/\.(txt|md|text)$/i) ? '📃' :
                        selectedFile.name.match(/\.(pptx?|ppt)$/i) ? '📑' : '📁'
                      ) : '📄'}
                    </span>
                    <span className="mt-2 text-xs font-bold text-fg break-all max-w-full px-2">
                      {selectedFile ? selectedFile.name : 'Upload Document'}
                    </span>
                    <span className="text-[11px] text-muted mt-0.5">
                      {selectedFile
                        ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Click to change document`
                        : 'PDF, Word (DOCX/DOC), Text (TXT/MD), CSV • Max 30MB'}
                    </span>
                  </label>
                </div>

                {errorMsg && (
                  <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs font-semibold text-danger">
                    ⚠️ {errorMsg}
                  </div>
                )}

                <div className="flex gap-3 justify-end border-t border-line pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="cursor-pointer rounded-lg border border-line bg-panel px-4 py-2 text-xs font-semibold text-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="cursor-pointer rounded-lg bg-orange px-5 py-2 text-xs font-bold text-white border-0 hover:brightness-105 shadow-md"
                  >
                    Publish Course
                  </button>
                </div>
              </form>
            ) : (
              /* Loader Screen */
              <div className="py-8 text-center">
                <div className="relative mx-auto h-12 w-12 mb-4 flex items-center justify-center">
                  <div className="absolute inset-0 animate-spin rounded-full border-4 border-orange/20 border-t-orange" />
                </div>
                <h3 className="font-display font-bold text-fg text-sm">
                  {stage === 'uploading' && '📤 Uploading Document...'}
                  {stage === 'parsing' && '🔍 Parsing Text Content...'}
                  {stage === 'structuring' && '🧠 Chunking & Structuring Curriculum...'}
                  {stage === 'finalizing' && '✨ Synthesizing Study Notes...'}
                  {!stage && '⚡ Creating Course Module...'}
                </h3>
                <p className="mt-2 text-xs text-muted max-w-[260px] mx-auto leading-relaxed">
                  Structuring course curriculum, lessons, and assessment questions...
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Edit Course Modal */}
      {editingCourse && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-2xl animate-rise-in text-fg my-auto">
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="font-display text-lg font-bold text-fg">Edit Course Details</h2>
                <button
                  type="button"
                  onClick={() => setEditingCourse(null)}
                  className="cursor-pointer text-muted hover:text-fg border-0 bg-transparent text-lg font-semibold"
                >
                  ×
                </button>
              </div>

              <div className="space-y-1">
                <label htmlFor="edit-course-title" className="text-xs font-semibold text-muted">Course Name</label>
                <input
                  id="edit-course-title"
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-fg placeholder-muted focus:border-orange focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="edit-course-desc" className="text-xs font-semibold text-muted">Course Description</label>
                <textarea
                  id="edit-course-desc"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows="3"
                  className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-fg placeholder-muted focus:border-orange focus:outline-none resize-none"
                  required
                />
              </div>

              {/* Replace Document Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted">Course Document</span>
                  <span className="text-[11px] text-muted font-mono truncate max-w-[200px]" title={editingCourse.fileName}>
                    📄 {editingCourse.fileName}
                  </span>
                </div>

                <label className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition p-4 text-center ${
                  editFile ? 'border-orange bg-orange/5' : 'border-line bg-ink/40 hover:border-orange/50 hover:bg-ink'
                }`}>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.text,.md,.markdown,.rtf,.html,.htm,.csv,.pptx,.ppt,.json"
                    onChange={handleEditFileChange}
                    className="hidden"
                  />
                  <span className="text-2xl">
                    {editFile ? (
                      editFile.name.endsWith('.pdf') ? '📄' :
                      editFile.name.match(/\.(docx?|doc)$/i) ? '📝' :
                      editFile.name.match(/\.(txt|md|text)$/i) ? '📃' : '📁'
                    ) : '🔄'}
                  </span>
                  <span className="mt-1.5 text-xs font-bold text-fg break-all max-w-full px-2">
                    {editFile ? editFile.name : 'Upload New Document to Replace (Optional)'}
                  </span>
                  <span className="text-[10px] text-muted mt-0.5">
                    {editFile
                      ? `${(editFile.size / (1024 * 1024)).toFixed(2)} MB • Click to change document`
                      : 'PDF, Word (DOCX), TXT, MD • Re-generates lessons & re-indexes knowledge'}
                  </span>
                  {editFile && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.preventDefault()
                        ev.stopPropagation()
                        setEditFile(null)
                      }}
                      className="mt-2 text-[11px] text-danger hover:underline cursor-pointer bg-transparent border-0 font-semibold"
                    >
                      ✕ Keep current document
                    </button>
                  )}
                </label>
              </div>

              {editErrorMsg && (
                <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs font-semibold text-danger">
                  ⚠️ {editErrorMsg}
                </div>
              )}

              <div className="flex gap-3 justify-end border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => setEditingCourse(null)}
                  className="cursor-pointer rounded-lg border border-line bg-panel px-4 py-2 text-xs font-semibold text-muted hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="cursor-pointer rounded-lg bg-orange px-5 py-2 text-xs font-bold text-white border-0 hover:brightness-105 shadow-md disabled:opacity-60"
                >
                  {isUpdating ? (editFile ? 'Reprocessing & Saving...' : 'Saving...') : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* View Curriculum / Details Modal */}
      {viewingCourse && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-3xl border border-line bg-panel p-6 shadow-2xl animate-rise-in text-fg my-auto space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-fg">{viewingCourse.title}</h2>
                <p className="text-xs text-muted mt-0.5">Reference Document: 📄 {viewingCourse.fileName}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingCourse(null)}
                className="cursor-pointer text-muted hover:text-fg border-0 bg-transparent text-lg font-semibold"
              >
                ×
              </button>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-1">Description</h4>
              <p className="text-xs text-fg leading-relaxed bg-ink p-3 rounded-xl border border-line">
                {viewingCourse.description}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Curriculum Lessons</h4>
              {(() => {
                const curriculumData = typeof viewingCourse.curriculum === 'string'
                  ? JSON.parse(viewingCourse.curriculum)
                  : (viewingCourse.curriculum || {})
                const lessons = curriculumData.lessons || []
                const modules = curriculumData.curriculum || []

                return (
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                    {lessons.length > 0 ? (
                      <div className="space-y-1.5">
                        {lessons.map((l, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-ink border border-line text-xs">
                            <span className="font-medium text-fg">{idx + 1}. {l.title}</span>
                            <span className="text-[10px] text-muted">{l.duration || '10 mins'}</span>
                          </div>
                        ))}
                      </div>
                    ) : modules.length > 0 ? (
                      <div className="space-y-2">
                        {modules.map((m, idx) => (
                          <div key={idx} className="p-3 rounded-lg bg-ink border border-line text-xs space-y-1">
                            <div className="flex justify-between font-bold text-fg">
                              <span>Module {idx + 1}: {m.title}</span>
                              <span className="text-muted text-[10px]">{m.lessons} Lessons • {m.duration}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted italic">Standard dynamic curriculum enabled.</p>
                    )}
                  </div>
                )
              })()}
            </div>

            <div className="flex justify-end border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setViewingCourse(null)}
                className="cursor-pointer rounded-lg border border-line bg-ink px-4 py-2 text-xs font-semibold text-fg hover:border-sky/40"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}

export default AdminCourses

