import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'

const AdminCourses = () => {
  const [coursesList, setCoursesList] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Creation modal state
  const [showModal, setShowModal] = useState(false)
  const [createMode, setCreateMode] = useState('pdf') // 'pdf' | 'manual'
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Data Science')
  const [level, setLevel] = useState('Intermediate')
  const [selectedFile, setSelectedFile] = useState(null)
  
  // Generation loader state
  const [isGenerating, setIsGenerating] = useState(false)
  const [stage, setStage] = useState('') // uploading | parsing | structuring | finalizing
  const [errorMsg, setErrorMsg] = useState('')

  // Edit modal state
  const [editingCourse, setEditingCourse] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [editErrorMsg, setEditErrorMsg] = useState('')

  // View details modal state
  const [viewingCourse, setViewingCourse] = useState(null)

  const fetchCourses = async () => {
    try {
      setLoading(true)
      const data = await api.getCourses()
      setCoursesList(data || [])
    } catch (err) {
      console.error('Failed to load courses:', err)
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
      if (file.type !== 'application/pdf') {
        setErrorMsg('Only PDF files are supported currently.')
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
      setErrorMsg('Course title and description are required.')
      return
    }

    if (createMode === 'pdf' && !selectedFile) {
      setErrorMsg('Please select a PDF document for reference.')
      return
    }

    setIsGenerating(true)
    setErrorMsg('')

    if (createMode === 'pdf') {
      setStage('uploading')
      const t1 = setTimeout(() => setStage('parsing'), 2000)
      const t2 = setTimeout(() => setStage('structuring'), 4500)
      const t3 = setTimeout(() => setStage('finalizing'), 8000)

      try {
        await api.adminUploadCourse(title.trim(), description.trim(), selectedFile)
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
        setIsGenerating(false)
        setShowModal(false)
        resetCreateForm()
        fetchCourses()
      } catch (err) {
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
        console.error('Course publish error:', err)
        setErrorMsg(err.message || 'An error occurred during course generation.')
        setIsGenerating(false)
      }
    } else {
      // Manual Course Creation
      try {
        await api.adminCreateManualCourse({
          title: title.trim(),
          description: description.trim(),
          category,
          level
        })
        setIsGenerating(false)
        setShowModal(false)
        resetCreateForm()
        fetchCourses()
      } catch (err) {
        console.error('Manual course creation error:', err)
        setErrorMsg(err.message || 'Failed to create course.')
        setIsGenerating(false)
      }
    }
  }

  const resetCreateForm = () => {
    setTitle('')
    setDescription('')
    setSelectedFile(null)
    setCategory('Data Science')
    setLevel('Intermediate')
    setErrorMsg('')
  }

  const handleOpenEdit = (course) => {
    setEditingCourse(course)
    setEditTitle(course.title)
    setEditDescription(course.description)
    setEditErrorMsg('')
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editTitle.trim() || !editDescription.trim()) {
      setEditErrorMsg('Title and description cannot be empty.')
      return
    }

    setIsUpdating(true)
    setEditErrorMsg('')
    try {
      await api.adminUpdateCourse(editingCourse.id, {
        title: editTitle.trim(),
        description: editDescription.trim()
      })
      setEditingCourse(null)
      fetchCourses()
    } catch (err) {
      console.error('Update course error:', err)
      setEditErrorMsg(err.message || 'Failed to update course.')
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
      fetchCourses()
    } catch (err) {
      console.error('Delete course error:', err)
      alert(err.message || 'Failed to delete course.')
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
            Get started by uploading a textbook reference PDF or manually creating a course module.
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
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {coursesList.map((course) => {
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
                  <span className="absolute top-4 right-4 rounded-full bg-white/15 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
                    {lessonCount} Lessons
                  </span>
                  <span className="absolute top-4 left-4 rounded-full bg-orange/80 backdrop-blur-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                    {course.fileName === 'Manual Entry' ? 'Manual' : 'RAG PDF'}
                  </span>
                  <h3 className="font-display text-base font-bold truncate">{course.title}</h3>
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <p className="text-xs text-muted leading-relaxed flex-1 line-clamp-3">
                    {course.description}
                  </p>
                  <div className="mt-4 border-t border-line pt-4 flex items-center justify-between text-xs">
                    <span className="text-muted truncate max-w-[130px]" title={course.fileName}>
                      📄 {course.fileName}
                    </span>
                    <div className="flex items-center gap-2">
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

                {/* Mode Selector Tabs */}
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-ink p-1 border border-line text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setCreateMode('pdf')}
                    className={`py-2 rounded-lg transition border-0 cursor-pointer ${
                      createMode === 'pdf' ? 'bg-orange text-white shadow-sm' : 'text-muted hover:text-fg'
                    }`}
                  >
                    📄 PDF Upload (RAG)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateMode('manual')}
                    className={`py-2 rounded-lg transition border-0 cursor-pointer ${
                      createMode === 'manual' ? 'bg-orange text-white shadow-sm' : 'text-muted hover:text-fg'
                    }`}
                  >
                    ✏️ Manual Creation
                  </button>
                </div>

                <div className="space-y-1">
                  <label htmlFor="course-title" className="text-xs font-semibold text-muted">Course Name</label>
                  <input
                    id="course-title"
                    type="text"
                    placeholder="e.g. Intro to RAG Architectures"
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

                {createMode === 'pdf' ? (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted">Reference PDF Document</label>
                    <label className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-ink/50 p-6 text-center hover:border-orange/50 hover:bg-ink">
                      <input
                        type="file"
                        accept=".pdf"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <span className="text-2xl">📄</span>
                      <span className="mt-2 text-xs font-bold text-fg">
                        {selectedFile ? selectedFile.name : 'Upload PDF Document'}
                      </span>
                      <span className="text-[10px] text-muted mt-0.5">Max size 25MB</span>
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted">Category</label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-xs text-fg focus:border-orange focus:outline-none"
                      >
                        <option value="Data Science">Data Science</option>
                        <option value="Development">Development</option>
                        <option value="Design">Design</option>
                        <option value="Security">Security</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted">Difficulty Level</label>
                      <select
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-xs text-fg focus:border-orange focus:outline-none"
                      >
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                      </select>
                    </div>
                  </div>
                )}

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
                    {createMode === 'pdf' ? 'Publish RAG Course' : 'Create Course'}
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
                  rows="4"
                  className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-fg placeholder-muted focus:border-orange focus:outline-none resize-none"
                  required
                />
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
                  {isUpdating ? 'Saving...' : 'Save Changes'}
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
