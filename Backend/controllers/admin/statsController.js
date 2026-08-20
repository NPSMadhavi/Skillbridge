import prisma from '../../config/prisma.js';

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
