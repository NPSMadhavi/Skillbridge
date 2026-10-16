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
      const isConnError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      const message = isConnError
        ? 'AI Microservice is not running. Please start the AI service on port 8000.'
        : (error.response?.data?.detail || error.message || 'Failed to generate face embeddings.');
      const err = new Error(message);
      err.statusCode = error.response?.status || 500;
      throw err;
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

      const payload = {
        candidates: pythonCandidates,
      };

      if (Array.isArray(queryImageBase64)) {
        payload.query_images = queryImageBase64;
        payload.query_image = queryImageBase64[0];
      } else {
        payload.query_image = queryImageBase64;
      }

      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/face/verify`, payload);

      return {
        matched: response.data.matched,
        id: response.data.user_id,
        score: response.data.confidence
      };
    } catch (error) {
      console.error('Error verifying face in Python AI service:', error.response?.data || error.message);
      const isConnError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      const message = isConnError
        ? 'AI Microservice is not running. Please start the AI service on port 8000.'
        : (error.response?.data?.detail || error.message || 'Face verification failed.');
      const err = new Error(message);
      err.statusCode = error.response?.status || 500;
      throw err;
    }
  }

  /**
   * Starts a server-managed guided face enrollment session.
   * @returns {Promise<{session_id: string, expires_at: number, steps: Array<string>, nonce: string}>}
   */
  async startFaceEnrollmentSession() {
    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/face/enrollment/start`);
      return response.data;
    } catch (error) {
      console.error('Error starting face enrollment session in Python AI service:', error.response?.data || error.message);
      const isConnError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      const message = isConnError
        ? 'AI Microservice is not running. Please start the AI service on port 8000.'
        : (error.response?.data?.detail || error.message || 'Failed to start face enrollment session.');
      const err = new Error(message);
      err.statusCode = error.response?.status || 500;
      throw err;
    }
  }

  /**
   * Verifies multi-pose frames, liveness anti-spoofing, and completes enrollment.
   * @param {Object} payload { session_id, frames: { look_straight, look_up, turn_left, turn_right, look_down }, metadata }
   * @returns {Promise<{success: boolean, session_id: string, encrypted_embedding: string, thumbnail_image: string, liveness_verified: boolean}>}
   */
  async completeFaceEnrollment(payload) {
    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/face/enrollment/complete`, payload);
      return response.data;
    } catch (error) {
      console.error('Error completing face enrollment in Python AI service:', error.response?.data || error.message);
      const isConnError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      const message = isConnError
        ? 'AI Microservice is not running. Please start the AI service on port 8000.'
        : (error.response?.data?.detail || error.message || 'Face enrollment validation failed.');
      const err = new Error(message);
      err.statusCode = error.response?.status || 400;
      throw err;
    }
  }
}

export default new PythonService();
