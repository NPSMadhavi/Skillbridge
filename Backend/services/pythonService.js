import axios from 'axios';

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

class PythonService {
  /**
   * Registers user face image(s) to generate encrypted face embeddings.
   * @param {string|Array<string>} imageBase64 Base64 string of the face image (or list of base64 strings)
   * @returns {Promise<string>} Encrypted embedding string returned from Python AI service
   */
  async registerFace(imageBase64) {
    try {
      const payload = {};
      if (Array.isArray(imageBase64)) {
        payload.images_base64 = imageBase64;
      } else {
        payload.image_base64 = imageBase64;
      }

      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/face/register`, payload);
      return response.data.encrypted_embedding;
    } catch (error) {
      console.error('Error registering face in Python AI service:', error.response?.data || error.message);
      throw new Error(error.response?.data?.detail || 'Failed to generate face embeddings.');
    }
  }

  /**
   * Verifies a scanned face against a list of candidates' encrypted embeddings.
   * @param {string} queryImageBase64 Scanned frame
   * @param {Array<{id: string, faceEmbedding: string}>} candidates List of candidates
   * @returns {Promise<{matched: boolean, id: string|null, score: number}>} Verification result
   */
  async verifyFace(queryImageBase64, candidates) {
    try {
      // Map to format Python service expects: list of dicts with id and encrypted_embedding
      const pythonCandidates = candidates.map(c => ({
        id: c.id,
        encrypted_embedding: c.faceEmbedding
      }));

      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/face/verify`, {
        query_image: queryImageBase64,
        candidates: pythonCandidates,
      });

      return {
        matched: response.data.matched,
        id: response.data.user_id,
        score: response.data.confidence
      };
    } catch (error) {
      console.error('Error verifying face in Python AI service:', error.response?.data || error.message);
      throw new Error(error.response?.data?.detail || 'Face verification failed.');
    }
  }
}

export default new PythonService();
