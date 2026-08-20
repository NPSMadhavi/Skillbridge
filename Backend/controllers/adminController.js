import prisma from '../config/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pythonService from '../services/pythonService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'ADMIN' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, admin: { email: admin.email } });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'An error occurred during admin login.' });
  }
};

export const checkUserExists = async (req, res) => {
  const { finNumber, email, faceIdData } = req.body;

  try {
    if (finNumber) {
      const existingFin = await prisma.user.findUnique({
        where: { finNumber: finNumber.trim().toUpperCase() },
        select: { id: true, fullName: true, finNumber: true, email: true },
      });
      if (existingFin) {
        return res.json({
          exists: true,
          field: 'finNumber',
          message: `User already exists with this FIN number (${existingFin.fullName}).`,
          user: existingFin,
        });
      }
    }

    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, fullName: true, finNumber: true, email: true },
      });
      if (existingEmail) {
        return res.json({
          exists: true,
          field: 'email',
          message: `User already exists with this email address (${existingEmail.fullName}).`,
          user: existingEmail,
        });
      }
    }

    if (faceIdData) {
      const candidates = await prisma.user.findMany({
        where: { faceEmbedding: { not: null } },
        select: { id: true, fullName: true, finNumber: true, faceEmbedding: true },
      });

      if (candidates.length > 0) {
        const queryFace = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;
        const verifyResult = await pythonService.verifyFace(queryFace, candidates);
        if (verifyResult && verifyResult.matched && verifyResult.id) {
          const matchedUser = candidates.find((c) => c.id === verifyResult.id);
          return res.json({
            exists: true,
            field: 'faceIdData',
            message: `User already exists with this face (${matchedUser?.fullName || 'Registered User'} - FIN: ${matchedUser?.finNumber || 'N/A'}).`,
            user: matchedUser,
          });
        }
      }
    }

    return res.json({ exists: false });
  } catch (error) {
    console.error('Check user exists error:', error);
    res.status(500).json({ error: 'Error checking user duplication.' });
  }
};

export const registerUser = async (req, res) => {
  const { fullName, finNumber, preferLanguage, email, password, faceIdData, country, assignedCourseIds } = req.body;

  if (!fullName || !finNumber || !preferLanguage || !email || !password || !country) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Check if user already exists (by email or FIN)
    const existingEmail = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existingEmail) {
      return res.status(400).json({ error: 'User already exists with this email address.' });
    }

    const existingFin = await prisma.user.findUnique({ where: { finNumber: finNumber.trim().toUpperCase() } });
    if (existingFin) {
      return res.status(400).json({ error: 'User already exists with this FIN number.' });
    }

    let faceEmbedding = null;
    if (faceIdData) {
      try {
        // Check if face is already registered to any existing user
        const candidates = await prisma.user.findMany({
          where: { faceEmbedding: { not: null } },
          select: { id: true, fullName: true, finNumber: true, faceEmbedding: true },
        });

        if (candidates.length > 0) {
          const queryFace = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;
          const verifyResult = await pythonService.verifyFace(queryFace, candidates);
          if (verifyResult && verifyResult.matched && verifyResult.id) {
            const matchedUser = candidates.find((c) => c.id === verifyResult.id);
            const matchedName = matchedUser?.fullName ? ` (${matchedUser.fullName} - FIN: ${matchedUser.finNumber})` : '';
            return res.status(400).json({
              error: `User already exists with this face${matchedName}.`
            });
          }
        }

        faceEmbedding = await pythonService.registerFace(faceIdData);
      } catch (err) {
        if (err.message && err.message.includes('already exists')) {
          return res.status(400).json({ error: err.message });
        }
        return res.status(422).json({ error: `Face biometric vector enrollment failed: ${err.message}` });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const faceImage = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;

    const newUser = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        finNumber,
        preferredLanguage: preferLanguage,
        email: email.trim().toLowerCase(),
        passwordHash,
        country: country.trim(),
        faceImage,
        faceEmbedding,
        role: 'STUDENT',
      },
    });

    // Create course assignments if provided
    if (Array.isArray(assignedCourseIds) && assignedCourseIds.length > 0) {
      await prisma.userCourseAssignment.createMany({
        data: assignedCourseIds.map((courseId) => ({
          userId: newUser.id,
          courseId,
        })),
        skipDuplicates: true,
      });
    }

    // Fetch assigned courses info
    const assignments = await prisma.userCourseAssignment.findMany({
      where: { userId: newUser.id },
      include: { course: { select: { id: true, title: true } } },
    });

    res.status(201).json({
      message: 'User registered successfully.',
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        email: newUser.email,
        finNumber: newUser.finNumber,
        preferLanguage: newUser.preferredLanguage,
        country: newUser.country,
        status: newUser.status,
        hasFaceId: !!newUser.faceEmbedding,
        registeredAt: newUser.registeredAt,
        assignedCourseIds: assignments.map((a) => a.courseId),
        assignedCourses: assignments.map((a) => ({ id: a.courseId, title: a.course?.title || a.courseId })),
      },
    });
  } catch (error) {
    console.error('Register user error:', error);
    res.status(500).json({ error: 'An error occurred while registering user.' });
  }
};

export const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        assignments: {
          include: {
            course: { select: { id: true, title: true } },
          },
        },
      },
    });

    const allProgress = await prisma.courseProgress.findMany();

    // Return users list format matching the frontend requirements
    const formatted = users.map(user => {
      const userProgs = allProgress.filter(p => p.userId === user.id || p.userId === user.email || p.userId === user.finNumber);
      const completedCount = userProgs.filter(p => p.completed || p.progress >= 100).length;
      const inProgressCount = userProgs.filter(p => !p.completed && p.progress > 0 && p.progress < 100).length;

      const assignedCourses = (user.assignments || []).map(a => ({
        id: a.courseId,
        title: a.course?.title || a.courseId,
      }));
      const assignedCourseIds = (user.assignments || []).map(a => a.courseId);

      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferLanguage: user.preferredLanguage,
        country: user.country,
        status: user.status,
        faceIdData: user.faceImage, // raw base64 image data
        registeredAt: user.registeredAt,
        assignedCourses,
        assignedCourseIds,
        progressSummary: {
          completedCourses: completedCount,
          inProgressCourses: inProgressCount,
          totalStarted: userProgs.length,
        }
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'An error occurred while fetching users.' });
  }
};

export const getStats = async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const faceEnrolled = await prisma.user.count({
      where: { faceEmbedding: { not: null } },
    });
    const uniqueCountries = await prisma.user.groupBy({
      by: ['country'],
    });
    const totalAssignments = await prisma.userCourseAssignment.count();

    res.json({
      totalUsers,
      faceEnrolled,
      regionsCovered: uniqueCountries.length,
      pendingFaceId: totalUsers - faceEnrolled,
      totalAssignments,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'An error occurred while fetching stats.' });
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { fullName, finNumber, preferLanguage, email, password, country, status, faceIdData, assignedCourseIds } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (email && email.toLowerCase() !== user.email) {
      const dupEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (dupEmail) {
        return res.status(400).json({ error: 'A user with this email is already registered.' });
      }
    }

    if (finNumber && finNumber !== user.finNumber) {
      const dupFin = await prisma.user.findUnique({ where: { finNumber } });
      if (dupFin) {
        return res.status(400).json({ error: 'A user with this FIN number is already registered.' });
      }
    }

    let faceEmbedding = undefined;
    let faceImage = undefined;
    if (faceIdData) {
      try {
        faceEmbedding = await pythonService.registerFace(faceIdData);
        faceImage = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;
      } catch (err) {
        return res.status(422).json({ error: `Face biometric vector update failed: ${err.message}` });
      }
    }

    const updateData = {};
    if (fullName) updateData.fullName = fullName.trim();
    if (finNumber) updateData.finNumber = finNumber.trim();
    if (preferLanguage) updateData.preferredLanguage = preferLanguage;
    if (email) updateData.email = email.trim().toLowerCase();
    if (country) updateData.country = country.trim();
    if (status) updateData.status = status;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }
    if (faceImage !== undefined) updateData.faceImage = faceImage;
    if (faceEmbedding !== undefined) updateData.faceEmbedding = faceEmbedding;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Update course assignments if provided
    if (Array.isArray(assignedCourseIds)) {
      await prisma.userCourseAssignment.deleteMany({ where: { userId: id } });
      if (assignedCourseIds.length > 0) {
        await prisma.userCourseAssignment.createMany({
          data: assignedCourseIds.map(cId => ({ userId: id, courseId: cId })),
          skipDuplicates: true,
        });
      }
    }

    const assignments = await prisma.userCourseAssignment.findMany({
      where: { userId: id },
      include: { course: { select: { id: true, title: true } } },
    });

    res.json({
      message: 'User updated successfully.',
      user: {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        finNumber: updated.finNumber,
        preferLanguage: updated.preferredLanguage,
        country: updated.country,
        status: updated.status,
        faceIdData: updated.faceImage,
        assignedCourseIds: assignments.map(a => a.courseId),
        assignedCourses: assignments.map(a => ({ id: a.courseId, title: a.course?.title || a.courseId })),
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'An error occurred while updating user.' });
  }
};

export const assignCoursesToUser = async (req, res) => {
  const { id } = req.params;
  const { courseIds } = req.body;

  if (!Array.isArray(courseIds)) {
    return res.status(400).json({ error: 'courseIds must be an array of course IDs.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Delete existing and set new assignments
    await prisma.userCourseAssignment.deleteMany({ where: { userId: id } });
    if (courseIds.length > 0) {
      await prisma.userCourseAssignment.createMany({
        data: courseIds.map(courseId => ({
          userId: id,
          courseId,
        })),
        skipDuplicates: true,
      });
    }

    const assignments = await prisma.userCourseAssignment.findMany({
      where: { userId: id },
      include: { course: { select: { id: true, title: true } } },
    });

    res.json({
      message: 'Course assignments updated successfully.',
      userId: id,
      assignedCourseIds: assignments.map(a => a.courseId),
      assignedCourses: assignments.map(a => ({ id: a.courseId, title: a.course?.title || a.courseId })),
    });
  } catch (error) {
    console.error('Assign courses to user error:', error);
    res.status(500).json({ error: 'Failed to update course assignments.' });
  }
};

export const assignUsersToCourse = async (req, res) => {
  const { id } = req.params; // courseId
  const { userIds } = req.body;

  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: 'userIds must be an array of user IDs.' });
  }

  try {
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    // Replace assignments for this course
    await prisma.userCourseAssignment.deleteMany({ where: { courseId: id } });
    if (userIds.length > 0) {
      await prisma.userCourseAssignment.createMany({
        data: userIds.map(userId => ({
          userId,
          courseId: id,
        })),
        skipDuplicates: true,
      });
    }

    const assignments = await prisma.userCourseAssignment.findMany({
      where: { courseId: id },
      include: { user: { select: { id: true, fullName: true, email: true, finNumber: true } } },
    });

    res.json({
      message: 'Course learners assigned successfully.',
      courseId: id,
      assignedUserIds: assignments.map(a => a.userId),
      assignedUsers: assignments.map(a => a.user),
    });
  } catch (error) {
    console.error('Assign users to course error:', error);
    res.status(500).json({ error: 'Failed to assign learners to course.' });
  }
};

export const getCourseAssignments = async (req, res) => {
  const { id } = req.params; // courseId

  try {
    const assignments = await prisma.userCourseAssignment.findMany({
      where: { courseId: id },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, finNumber: true, country: true, status: true }
        }
      },
    });

    res.json({
      courseId: id,
      totalAssigned: assignments.length,
      assignedUsers: assignments.map(a => a.user),
    });
  } catch (error) {
    console.error('Get course assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch course assignments.' });
  }
};

export const toggleUserStatus = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const updated = await prisma.user.update({
      where: { id },
      data: { status: nextStatus },
    });

    res.json({
      message: `User status changed to ${nextStatus}.`,
      user: {
        id: updated.id,
        fullName: updated.fullName,
        status: updated.status,
      }
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ error: 'An error occurred while changing user status.' });
  }
};


export const getUserProgress = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true, finNumber: true, preferredLanguage: true, country: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const dbCourses = await prisma.course.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, description: true, curriculum: true }
    });

    const progressRecords = await prisma.courseProgress.findMany({
      where: {
        OR: [
          { userId: id },
          { userId: user.email },
          { userId: user.finNumber }
        ]
      }
    });

    const COURSE_TITLES_MAP = {
      'ml-python': 'Machine Learning with Python',
      'web-dev': 'Full-Stack Web Development',
      'ui-design': 'UI Design Systems Mastery',
      'cyber-sec': 'Modern Cybersecurity Essentials',
    };

    const coursesList = dbCourses.map(c => {
      const rec = progressRecords.find(p =>
        String(p.courseId).toLowerCase() === String(c.id).toLowerCase() ||
        String(p.courseId).toLowerCase() === String(c.title).toLowerCase()
      );
      let lessonIds = [];
      if (rec?.completedLessonIds) {
        try {
          const parsed = typeof rec.completedLessonIds === 'string'
            ? JSON.parse(rec.completedLessonIds)
            : rec.completedLessonIds;
          if (Array.isArray(parsed)) {
            lessonIds = Array.from(new Set(parsed.filter(id => id !== null && id !== undefined).map(String)));
          }
        } catch (e) {
          lessonIds = [];
        }
      }

      const totalLessons = Array.isArray(c.curriculum?.lessons) && c.curriculum.lessons.length > 0
        ? c.curriculum.lessons.length
        : 5;

      return {
        id: c.id,
        title: c.title,
        description: c.description,
        progress: rec ? Math.min(100, Math.max(0, rec.progress)) : 0,
        completed: rec ? (rec.completed || rec.progress >= 100) : false,
        completedCount: Math.min(lessonIds.length, totalLessons),
        totalLessons,
        updatedAt: rec?.updatedAt || null
      };
    });

    // Also append progress for non-RAG default courses if progress records exist
    progressRecords.forEach(rec => {
      if (!coursesList.some(cp => String(cp.id).toLowerCase() === String(rec.courseId).toLowerCase() || String(cp.title).toLowerCase() === String(rec.courseId).toLowerCase())) {
        let lessonIds = [];
        if (rec.completedLessonIds) {
          try {
            const parsed = typeof rec.completedLessonIds === 'string'
              ? JSON.parse(rec.completedLessonIds)
              : rec.completedLessonIds;
            if (Array.isArray(parsed)) {
              lessonIds = Array.from(new Set(parsed.filter(id => id !== null && id !== undefined).map(String)));
            }
          } catch (e) {
            lessonIds = [];
          }
        }

        const formattedTitle = COURSE_TITLES_MAP[rec.courseId] || (rec.courseId.charAt(0).toUpperCase() + rec.courseId.slice(1).replace(/-/g, ' '));

        coursesList.push({
          id: rec.courseId,
          title: formattedTitle,
          description: 'Course Progress Record',
          progress: Math.min(100, Math.max(0, rec.progress)),
          completed: rec.completed || rec.progress >= 100,
          completedCount: Math.min(lessonIds.length, 5),
          totalLessons: 5,
          updatedAt: rec.updatedAt
        });
      }
    });

    res.json({
      user,
      courses: coursesList
    });
  } catch (error) {
    console.error('Get user progress error:', error);
    res.status(500).json({ error: 'Failed to fetch user course progress.' });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Delete related records first
    await prisma.userCourseAssignment.deleteMany({ where: { userId: id } });
    await prisma.courseProgress.deleteMany({ where: { userId: id } });

    // Delete user record
    await prisma.user.delete({ where: { id } });

    res.json({
      message: 'User deleted successfully.',
      userId: id,
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'An error occurred while deleting user.' });
  }
};

