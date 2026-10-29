const getApiBaseUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;
    if (protocol === 'https:') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}/api/v1`;
    }
  }
  return 'http://localhost:5000/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

const getHeaders = (role = false) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  try {
    const adminSession = JSON.parse(sessionStorage.getItem('skillbridge_admin') || localStorage.getItem('skillbridge_admin') || 'null');
    const userSession = JSON.parse(sessionStorage.getItem('skillbridge_user') || localStorage.getItem('skillbridge_user') || 'null');
    const superAdminSession = JSON.parse(sessionStorage.getItem('skillbridge_super_admin') || localStorage.getItem('skillbridge_super_admin') || 'null');

    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const isAdminPath = path.startsWith('/admin');
    const isSuperAdminPath = path.startsWith('/super-admin');

    let token = null;
    let tenantId = 'default';

    // Strict role segregation when explicitly on admin/super routes, with safe fallback for shared learner routes
    if (role === 'super' || isSuperAdminPath) {
      token = superAdminSession?.token || null;
      tenantId = 'master';
    } else if (role === true || isAdminPath) {
      token = adminSession?.token || superAdminSession?.token || null;
      tenantId = adminSession?.tenant || adminSession?.slug || sessionStorage.getItem('skillbridge_tenant') || localStorage.getItem('skillbridge_tenant') || 'default';
    } else {
      token = userSession?.token || adminSession?.token || superAdminSession?.token || null;
      tenantId = userSession?.tenant?.code || userSession?.user?.tenantCode || adminSession?.tenant || adminSession?.slug || sessionStorage.getItem('skillbridge_tenant') || localStorage.getItem('skillbridge_tenant') || 'default';
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Attach tenant header for multi-database routing
    if (tenantId) {
      headers['x-tenant-id'] = tenantId;
    }
  } catch (e) {
    console.error('Error reading session token', e);
  }
  return headers;
};

export const api = {
  // Super Admin Control Plane APIs
  superAdminLogin: async (email, password) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to login as Super Admin.');
    }
    return res.json();
  },

  getSuperAdminMe: async () => {
    const res = await fetch(`${API_BASE_URL}/super-admin/auth/me`, {
      method: 'GET',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch Super Admin profile.');
    }
    return res.json();
  },

  getSuperAdmins: async () => {
    const res = await fetch(`${API_BASE_URL}/super-admin/admins`, {
      method: 'GET',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch Super Admins.');
    }
    return res.json();
  },

  createSuperAdmin: async (adminData) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/admins`, {
      method: 'POST',
      headers: getHeaders('super'),
      body: JSON.stringify(adminData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create Super Admin.');
    }
    return res.json();
  },

  deleteSuperAdmin: async (id) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/admins/${id}`, {
      method: 'DELETE',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete Super Admin.');
    }
    return res.json();
  },

  getCompanies: async () => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies`, {
      method: 'GET',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch companies.');
    }
    return res.json();
  },

  createCompany: async (companyData) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies`, {
      method: 'POST',
      headers: getHeaders('super'),
      body: JSON.stringify(companyData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create company and database.');
    }
    return res.json();
  },

  getCompany: async (id) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${id}`, {
      method: 'GET',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch company details.');
    }
    return res.json();
  },

  updateCompany: async (id, companyData) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${id}`, {
      method: 'PUT',
      headers: getHeaders('super'),
      body: JSON.stringify(companyData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update company.');
    }
    return res.json();
  },

  updateCompanyStatus: async (id, status) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${id}/status`, {
      method: 'PATCH',
      headers: getHeaders('super'),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update company status.');
    }
    return res.json();
  },

  deleteCompany: async (id, dropDatabase = true) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${id}?dropDatabase=${dropDatabase}`, {
      method: 'DELETE',
      headers: getHeaders('super'),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete company.');
    }
    return res.json();
  },

  // Company Admin Auth
  adminLogin: async (email, password, companyCode = null) => {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (companyCode) {
      headers['x-tenant-id'] = companyCode;
    }
    const res = await fetch(`${API_BASE_URL}/admin/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password, companyCode }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to login as admin.');
    }
    return res.json();
  },

  adminForgotPassword: async (email, companyCode = null) => {
    const headers = { 'Content-Type': 'application/json' };
    if (companyCode) {
      headers['x-tenant-id'] = companyCode;
    }
    const res = await fetch(`${API_BASE_URL}/admin/forgot-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, companyCode }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to initiate password reset.');
    }
    return res.json();
  },

  adminResetPassword: async ({ email, companyCode = null, code, newPassword }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (companyCode) {
      headers['x-tenant-id'] = companyCode;
    }
    const res = await fetch(`${API_BASE_URL}/admin/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, companyCode, code, newPassword }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to reset admin password.');
    }
    return res.json();
  },

  adminSetInitialPassword: async ({ email, companyCode = null, tempToken = null, newPassword }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (companyCode) {
      headers['x-tenant-id'] = companyCode;
    }
    const res = await fetch(`${API_BASE_URL}/admin/set-initial-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, companyCode, tempToken, newPassword }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to set permanent password.');
    }
    return res.json();
  },

  getAdminMe: async () => {


    const res = await fetch(`${API_BASE_URL}/admin/me`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch admin profile.');
    }
    return res.json();
  },

  // Company AI Tutor & Wake Word Settings
  getAiSettings: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/ai-settings`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch AI tutor settings.');
    }
    return res.json();
  },

  updateAiSettings: async (settings) => {
    const res = await fetch(`${API_BASE_URL}/admin/ai-settings`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save AI tutor settings.');
    }
    return res.json();
  },

  getCompanyAiSettings: async (companyCode = null) => {
    let code = companyCode;
    if (!code) {
      try {
        const userSession = JSON.parse(sessionStorage.getItem('skillbridge_user') || localStorage.getItem('skillbridge_user') || 'null');
        const adminSession = JSON.parse(sessionStorage.getItem('skillbridge_admin') || localStorage.getItem('skillbridge_admin') || 'null');
        code = userSession?.tenant?.code || userSession?.user?.tenantCode || userSession?.user?.tenant || userSession?.tenantCode || adminSession?.tenant || adminSession?.slug || sessionStorage.getItem('skillbridge_tenant') || localStorage.getItem('skillbridge_tenant') || 'default';
      } catch (_) {
        code = 'default';
      }
    }
    const cleanCode = (code || 'default').trim().toLowerCase();
    const res = await fetch(`${API_BASE_URL}/admin/company-ai-settings?code=${encodeURIComponent(cleanCode)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': cleanCode,
      },
    });
    if (!res.ok) {
      return {
        aiName: 'ARIA',
        wakeWord: 'Hey ARIA',
        aiVoiceGender: 'FEMALE',
        aiVoiceName: 'en-US-JennyNeural',
        aiVoiceRate: 1.0,
        aiVoicePitch: 1.0,
      };
    }
    return res.json();
  },


  // Company Admin Management
  getCompanyAdmins: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/admins`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch company administrators.');
    }
    return res.json();
  },

  createCompanyAdmin: async (adminData) => {
    const res = await fetch(`${API_BASE_URL}/admin/admins`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(adminData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create company administrator.');
    }
    return res.json();
  },

  deleteCompanyAdmin: async (id) => {
    const res = await fetch(`${API_BASE_URL}/admin/admins/${id}`, {
      method: 'DELETE',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete company administrator.');
    }
    return res.json();
  },

  // Admin User Enrollment
  registerUser: async (userData) => {
    const res = await fetch(`${API_BASE_URL}/admin/register`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const err = await res.json();
      const customErr = new Error(err.error || 'Failed to register user.');
      if (err.matchedUser) {
        customErr.matchedUser = err.matchedUser;
      }
      throw customErr;
    }
    return res.json();
  },

  // Check if user already exists (by FIN, email, or Face)
  checkUserExists: async ({ finNumber, email, faceIdData }) => {
    const res = await fetch(`${API_BASE_URL}/admin/check-user`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ finNumber, email, faceIdData }),
    });
    if (!res.ok) {
      const err = await res.json();
      const customErr = new Error(err.error || 'Failed to check user existence.');
      if (err.matchedUser) {
        customErr.matchedUser = err.matchedUser;
      }
      throw customErr;
    }
    return res.json();
  },

  // Start Server-Managed Guided Face Enrollment Session
  startFaceEnrollmentSession: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/face-enrollment/start`, {
      method: 'POST',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start face enrollment session.');
    }
    return res.json();
  },

  // Complete Server-Verified Guided Face Enrollment
  completeFaceEnrollment: async (enrollmentPayload) => {
    const res = await fetch(`${API_BASE_URL}/admin/face-enrollment/complete`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(enrollmentPayload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Face enrollment validation failed.');
    }
    return res.json();
  },

  // Admin User List
  getUsers: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/users`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch users.');
    }
    return res.json();
  },

  // Admin User Course Progress
  getUserProgress: async (userId) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/progress`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch user progress.');
    }
    return res.json();
  },

  // Admin Dashboard Stats
  getStats: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/stats`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch stats.');
    }
    return res.json();
  },

  // Admin Update User
  updateUser: async (id, userData) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update user.');
    }
    return res.json();
  },

  // Admin Delete User (requires admin password verification and unassigns courses)
  deleteUser: async (id, adminPassword) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
      method: 'DELETE',
      headers: {
        ...getHeaders(true),
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword || '',
      },
      body: JSON.stringify({ adminPassword }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete user.');
    }
    return res.json();
  },

  // Admin Toggle User Status
  toggleUserStatus: async (id) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${id}/status`, {
      method: 'PATCH',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to toggle user status.');
    }
    return res.json();
  },

  // Admin Assign Courses to User
  assignUserCourses: async (userId, courseIds) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/assignments`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ courseIds }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to assign courses to user.');
    }
    return res.json();
  },

  // Admin Assign Users to Course
  assignCourseUsers: async (courseId, userIds) => {
    const res = await fetch(`${API_BASE_URL}/admin/courses/${courseId}/assign-users`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ userIds }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to assign learners to course.');
    }
    return res.json();
  },

  // Admin Get Course Assignments
  getCourseAssignments: async (courseId) => {
    const res = await fetch(`${API_BASE_URL}/admin/courses/${courseId}/assignments`, {
      method: 'GET',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch course assignments.');
    }
    return res.json();
  },

  // Student Auth
  studentLogin: async (email, password, companyCode = 'default') => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': companyCode
      },
      body: JSON.stringify({ email, password, companyCode }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Invalid credentials.');
    }
    return res.json();
  },

  studentFaceLogin: async (faceIdData, companyCode = 'default') => {
    const res = await fetch(`${API_BASE_URL}/auth/face-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': companyCode
      },
      body: JSON.stringify({ faceIdData, companyCode }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Face verification failed.');
    }
    return res.json();
  },

  chatWithTutor: async (courseId, chatData) => {
    const url = `${API_BASE_URL}/courses/${courseId}/chat`;

    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({
        message: chatData.message || chatData.text,
        lessonTitle: chatData.lessonTitle,
        currentConcept: chatData.currentConcept,
        language: chatData.language,
        conversationHistory: chatData.conversationHistory || [],
        aiName: chatData.aiName || chatData.assistantName,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to chat with AI Tutor.');
    }
    const data = await res.json();
    return {
      text: data.reply || data.text || "I'm ready to help with your course questions!",
      reply: data.reply || data.text || "I'm ready to help with your course questions!",
      language: data.language,
      assistantName: data.assistantName
    };
  },

  updateCourseProgressDetails: async (courseId, details) => {
    const res = await fetch(`${API_BASE_URL}/courses/${courseId}/progress-details`, {
      method: 'PATCH',
      headers: getHeaders(false),
      body: JSON.stringify(details),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save progress details.');
    }
    return res.json();
  },

  adminUploadCourse: async (title, description, file) => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('file', file);

    const headers = getHeaders(true); // Admin authorization required
    delete headers['Content-Type']; // Let browser set boundary automatically for FormData

    const res = await fetch(`${API_BASE_URL}/courses/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to publish course.');
    }
    return res.json();
  },

  adminCreateManualCourse: async (courseData) => {
    const res = await fetch(`${API_BASE_URL}/courses/manual`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(courseData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create course.');
    }
    return res.json();
  },

  adminUpdateCourse: async (id, courseData) => {
    const isFormData = courseData instanceof FormData;
    const headers = getHeaders(true);
    if (isFormData) {
      delete headers['Content-Type'];
    }

    const res = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: 'PUT',
      headers,
      body: isFormData ? courseData : JSON.stringify(courseData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update course.');
    }
    return res.json();
  },


  getCourses: async (asAdmin) => {
    const isAdmin = asAdmin !== undefined ? asAdmin : (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin'));
    const res = await fetch(`${API_BASE_URL}/courses`, {
      method: 'GET',
      headers: getHeaders(isAdmin),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch courses catalog.');
    }
    const data = await res.json();
    try {
      if (Array.isArray(data) && typeof window !== 'undefined') {
        window.__courseCache = window.__courseCache || new Map();
        data.forEach(c => {
          if (c?.id) {
            window.__courseCache.set(String(c.id), c);
            try { sessionStorage.setItem(`skillbridge_cached_course_${c.id}`, JSON.stringify(c)); } catch (_) {}
          }
        });
        sessionStorage.setItem('skillbridge_cached_courses', JSON.stringify(data));
      }
    } catch (_) {}
    return data;
  },

  getCourseDetail: async (id) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: 'GET',
      headers: getHeaders(false),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch course details.');
    }
    const data = await res.json();
    try {
      if (data?.id && typeof window !== 'undefined') {
        window.__courseCache = window.__courseCache || new Map();
        window.__courseCache.set(String(data.id), data);
        sessionStorage.setItem(`skillbridge_cached_course_${data.id}`, JSON.stringify(data));
      }
    } catch (_) {}
    return data;
  },

  getCachedCourse: (id) => {
    if (!id || typeof window === 'undefined') return null;
    try {
      // 1. Check in-memory map
      if (window.__courseCache && window.__courseCache.has(String(id))) {
        return window.__courseCache.get(String(id));
      }
      // 2. Check course-specific sessionStorage
      const specific = sessionStorage.getItem(`skillbridge_cached_course_${id}`);
      if (specific) {
        const parsed = JSON.parse(specific);
        if (parsed?.id) {
          window.__courseCache = window.__courseCache || new Map();
          window.__courseCache.set(String(id), parsed);
          return parsed;
        }
      }
      // 3. Check catalog in sessionStorage
      const catalog = sessionStorage.getItem('skillbridge_cached_courses');
      if (catalog) {
        const list = JSON.parse(catalog);
        if (Array.isArray(list)) {
          const match = list.find(c => String(c.id) === String(id));
          if (match) {
            window.__courseCache = window.__courseCache || new Map();
            window.__courseCache.set(String(id), match);
            return match;
          }
        }
      }
    } catch (_) {}
    return null;
  },

  getLessonExplanation: async (id, lessonId, lessonTitle, language) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}/lessons/${lessonId}/explain`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({ lessonTitle, language }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch lesson explanation.');
    }
    return res.json();
  },

  explainCoursePage: async (courseId, pageNum, language) => {
    const res = await fetch(`${API_BASE_URL}/courses/${courseId}/page/${pageNum}/explain`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({ language }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to explain page content.');
    }
    return res.json();
  },

  getCourseOriginalFileUrl: (courseId, download = false) => {
    const headers = getHeaders(false);
    const token = headers['Authorization']?.replace(/^Bearer\s+/i, '');
    const params = new URLSearchParams();
    if (download) params.append('download', '1');
    if (token) params.append('token', token);
    const qs = params.toString();
    return `${API_BASE_URL}/courses/${courseId}/file${qs ? `?${qs}` : ''}`;
  },

  getCourseSlideImageUrl: (courseId, slideNum) => {
    const headers = getHeaders(false);
    const token = headers['Authorization']?.replace(/^Bearer\s+/i, '');
    return `${API_BASE_URL}/courses/${courseId}/slides/${slideNum}/image${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  getCoursePageImageUrl: (courseId, pageNum) => {
    const headers = getHeaders(false);
    const token = headers['Authorization']?.replace(/^Bearer\s+/i, '');
    return `${API_BASE_URL}/courses/${courseId}/pages/${pageNum}/image${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  getLessonQuiz: async (id, lessonId, lessonTitle, language) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}/lessons/${lessonId}/quiz`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({ lessonTitle, language }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to generate chapter assessment quiz.');
    }
    return res.json();
  },


  getCourseProgress: async (id) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}/progress`, {
      method: 'GET',
      headers: getHeaders(false),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch course progress.');
    }
    return res.json();
  },

  saveCourseProgress: async (id, progressData) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}/progress`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify(progressData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save course progress.');
    }
    return res.json();
  },

  adminDeleteCourse: async (id) => {
    const res = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: 'DELETE',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete course module.');
    }
    return res.json();
  },

  transcribeSpeech: async (audioBlob, language) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'voice.webm');
    if (language) {
      formData.append('language', language);
    }

    const headers = getHeaders(false);
    delete headers['Content-Type'];

    const res = await fetch(`${API_BASE_URL}/courses/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to transcribe audio.');
    }
    return res.json();
  },

  getTtsAudioUrl: (text, options = {}) => {
    const { voice, gender = 'FEMALE', rate = 1.0, pitch = 1.0 } = options;
    const params = new URLSearchParams({
      text: (text || '').trim(),
      gender,
      rate: String(rate),
      pitch: String(pitch),
    });
    if (voice) params.append('voice', voice);
    const headers = getHeaders(false);
    const token = headers['Authorization']?.replace('Bearer ', '');
    if (token) params.append('token', token);
    return `${API_BASE_URL}/tts/synthesize?${params.toString()}`;
  },

  // Dynamic Assistant Name & Voice Settings
  getAssistantSettings: async () => {
    const res = await fetch(`${API_BASE_URL}/assistant/settings`, {
      method: 'GET',
      headers: getHeaders(false),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch assistant settings.');
    }
    return res.json();
  },

  updateAssistantSettings: async (settings) => {
    const res = await fetch(`${API_BASE_URL}/admin/ai-settings`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update assistant settings.');
    }
    return res.json();
  },

  askVoiceAssistant: async (payload) => {
    const res = await fetch(`${API_BASE_URL}/voice/ask`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get answer from voice assistant.');
    }
    return res.json();
  },
};
