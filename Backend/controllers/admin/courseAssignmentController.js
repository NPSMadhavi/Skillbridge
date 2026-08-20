import prisma from '../../config/prisma.js';

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
