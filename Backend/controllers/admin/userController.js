import prisma from '../../config/prisma.js';
import bcrypt from 'bcryptjs';
import pythonService from '../../services/pythonService.js';

export const checkUserExists = async (req, res) => {
  const { finNumber, email, faceIdData } = req.body;

  try {
    if (finNumber) {
      const existingFin = await prisma.user.findUnique({
        where: { finNumber: finNumber.trim().toUpperCase() },
        select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true },
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
        select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true },
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
        select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true, faceEmbedding: true },
      });

      const verifyResult = await pythonService.verifyFace(faceIdData, candidates);
      if (verifyResult && verifyResult.matched && verifyResult.id) {
        const matchedUser = candidates.find((c) => c.id === verifyResult.id);
        return res.json({
          exists: true,
          field: 'faceIdData',
          message: `User already exists with this face (${matchedUser?.fullName || 'Registered User'} - FIN: ${matchedUser?.finNumber || 'N/A'}).`,
          user: {
            id: matchedUser?.id,
            fullName: matchedUser?.fullName,
            finNumber: matchedUser?.finNumber,
            email: matchedUser?.email,
            faceImage: matchedUser?.faceImage,
          },
        });
      }
    }

    return res.json({ exists: false });
  } catch (error) {
    console.error('Check user exists error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Error checking user duplication.' });
  }
};

export const registerUser = async (req, res) => {
  const { fullName, finNumber, preferLanguage, email, password, faceIdData, faceEnrollment, country, assignedCourseIds } = req.body;

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
    let faceImage = null;

    if (faceEnrollment && faceEnrollment.encryptedEmbedding) {
      faceEmbedding = faceEnrollment.encryptedEmbedding;
      faceImage = faceEnrollment.thumbnailImage || null;

      // Check if enrolled face matches any existing user
      try {
        const candidates = await prisma.user.findMany({
          where: { faceEmbedding: { not: null } },
          select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true, faceEmbedding: true },
        });

        if (candidates.length > 0 && faceImage) {
          const verifyResult = await pythonService.verifyFace(faceImage, candidates);
          if (verifyResult && verifyResult.matched && verifyResult.id) {
            const matchedUser = candidates.find((c) => c.id === verifyResult.id);
            const matchedName = matchedUser?.fullName ? ` (${matchedUser.fullName} - FIN: ${matchedUser.finNumber})` : '';
            return res.status(400).json({
              error: `User already exists with this face${matchedName}.`,
              matchedUser: {
                id: matchedUser?.id,
                fullName: matchedUser?.fullName,
                finNumber: matchedUser?.finNumber,
                email: matchedUser?.email,
                faceImage: matchedUser?.faceImage,
              },
            });
          }
        }
      } catch (err) {
        if (err.message && (err.message.includes('already exists') || err.message.includes('already registered'))) {
          return res.status(400).json({ error: err.message });
        }
      }
    } else if (faceIdData) {
      try {
        // Check if face is already registered to any existing user
        const candidates = await prisma.user.findMany({
          where: { faceEmbedding: { not: null } },
          select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true, faceEmbedding: true },
        });

        if (candidates.length > 0) {
          const verifyResult = await pythonService.verifyFace(faceIdData, candidates);
          if (verifyResult && verifyResult.matched && verifyResult.id) {
            const matchedUser = candidates.find((c) => c.id === verifyResult.id);
            const matchedName = matchedUser?.fullName ? ` (${matchedUser.fullName} - FIN: ${matchedUser.finNumber})` : '';
            return res.status(400).json({
              error: `User already exists with this face${matchedName}.`,
              matchedUser: {
                id: matchedUser?.id,
                fullName: matchedUser?.fullName,
                finNumber: matchedUser?.finNumber,
                email: matchedUser?.email,
                faceImage: matchedUser?.faceImage,
              },
            });
          }
        }

        faceEmbedding = await pythonService.registerFace(faceIdData);
        faceImage = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;
      } catch (err) {
        if (err.message && (err.message.includes('already exists') || err.message.includes('already registered'))) {
          return res.status(400).json({ error: err.message });
        }
        return res.status(422).json({ error: `Face biometric vector enrollment failed: ${err.message}` });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

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
    const isNewFace = Boolean(
      faceIdData &&
      (Array.isArray(faceIdData)
        ? (faceIdData.length > 0 && faceIdData[0] !== user.faceImage)
        : (faceIdData !== user.faceImage))
    );

    if (isNewFace) {
      try {
        const candidates = await prisma.user.findMany({
          where: {
            id: { not: id },
            faceEmbedding: { not: null },
          },
          select: { id: true, fullName: true, finNumber: true, email: true, faceImage: true, faceEmbedding: true },
        });

        if (candidates.length > 0) {
          const verifyResult = await pythonService.verifyFace(faceIdData, candidates);
          if (verifyResult && verifyResult.matched && verifyResult.id) {
            const matchedUser = candidates.find((c) => c.id === verifyResult.id);
            const matchedName = matchedUser?.fullName ? ` (${matchedUser.fullName} - FIN: ${matchedUser.finNumber})` : '';
            return res.status(400).json({
              error: `This face is already registered to another user${matchedName}.`,
            });
          }
        }

        faceEmbedding = await pythonService.registerFace(faceIdData);
        faceImage = Array.isArray(faceIdData) ? faceIdData[0] : faceIdData;
      } catch (err) {
        console.error('[BACKEND] Face update error in updateUser:', err.message, err.stack);
        if (err.message && (err.message.includes('already exists') || err.message.includes('already registered'))) {
          return res.status(400).json({ error: err.message });
        }
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
  const adminPassword = req.body?.adminPassword || req.headers['x-admin-password'];

  if (!adminPassword || typeof adminPassword !== 'string' || !adminPassword.trim()) {
    return res.status(400).json({ error: 'Admin password is required to delete a user.' });
  }

  try {
    // 1. Authenticate admin using the provided admin password
    const adminId = req.user?.id;
    const adminEmail = req.user?.email;

    let admin = null;
    if (adminId) {
      admin = await prisma.admin.findUnique({ where: { id: adminId } });
    }
    if (!admin && adminEmail) {
      admin = await prisma.admin.findUnique({ where: { email: adminEmail } });
    }
    // Fallback: check if admin is in User table with ADMIN role
    if (!admin) {
      if (adminId) {
        admin = await prisma.user.findFirst({ where: { id: adminId, role: 'ADMIN' } });
      }
      if (!admin && adminEmail) {
        admin = await prisma.user.findFirst({ where: { email: adminEmail, role: 'ADMIN' } });
      }
    }

    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ error: 'Admin identity could not be verified.' });
    }

    const isPasswordValid = await bcrypt.compare(adminPassword.trim(), admin.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Incorrect admin password. Deletion cancelled.' });
    }

    // 2. Fetch user to delete along with assigned courses
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            course: {
              select: { id: true, title: true }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // 3. First, unassign all courses assigned to this user
    const assignedCoursesCount = user.assignments?.length || 0;
    if (assignedCoursesCount > 0) {
      console.log(`[DeleteUser] Unassigning ${assignedCoursesCount} course(s) from user ${user.fullName} (${user.id}) before deletion`);
      await prisma.userCourseAssignment.deleteMany({ where: { userId: id } });
    }

    // 4. Delete user progress records
    await prisma.courseProgress.deleteMany({ where: { userId: id } });

    // 5. Finally, delete user record
    await prisma.user.delete({ where: { id } });

    console.log(`[DeleteUser] Successfully unassigned ${assignedCoursesCount} course(s) and deleted user ${user.fullName} (${user.id}).`);

    res.json({
      message: 'User unassigned from all courses and deleted successfully.',
      userId: id,
      unassignedCoursesCount: assignedCoursesCount
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'An error occurred while deleting user.' });
  }
};

export const startFaceEnrollment = async (req, res) => {
  try {
    const session = await pythonService.startFaceEnrollmentSession();
    res.json(session);
  } catch (error) {
    console.error('Start face enrollment error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to start face enrollment session.' });
  }
};

export const completeFaceEnrollment = async (req, res) => {
  try {
    const result = await pythonService.completeFaceEnrollment(req.body);
    res.json(result);
  } catch (error) {
    console.error('Complete face enrollment error:', error);
    res.status(error.statusCode || 400).json({ error: error.message || 'Face enrollment verification failed.' });
  }
};

