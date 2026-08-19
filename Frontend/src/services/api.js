const API_BASE_URL = '/api/v1';

const getHeaders = (isAdmin = false) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  try {
    const adminSession = JSON.parse(sessionStorage.getItem('skillbridge_admin') || 'null');
    const userSession = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null');

    const token = isAdmin
      ? (adminSession?.token || userSession?.token)
      : (userSession?.token || adminSession?.token);

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (e) {
    console.error('Error reading session token', e);
  }
  return headers;
};

export const api = {
  // Admin Auth
  adminLogin: async (email, password) => {
    const res = await fetch(`${API_BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to login as admin.');
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
      throw new Error(err.error || 'Failed to register user.');
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

  // Admin Delete User
  deleteUser: async (id) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
      method: 'DELETE',
      headers: getHeaders(true),
    });
    if (!res.ok) {
      const err = await res.json();
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
  studentLogin: async (email, password) => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Invalid credentials.');
    }
    return res.json();
  },

  studentFaceLogin: async (faceIdData) => {
    const res = await fetch(`${API_BASE_URL}/auth/face-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faceIdData }),
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
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to send message to AI Tutor.');
    }
    const data = await res.json();
    return { text: data.reply || data.text, reply: data.reply || data.text, language: data.language };
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
      throw new Error(err.error || 'Failed to publish RAG course.');
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
    const res = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: JSON.stringify(courseData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update course.');
    }
    return res.json();
  },


  getCourses: async () => {
    const res = await fetch(`${API_BASE_URL}/courses`, {
      method: 'GET',
      headers: getHeaders(false),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch courses catalog.');
    }
    return res.json();
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
    return res.json();
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
};
