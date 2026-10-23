import axios from 'axios';
import FormData from 'form-data';

function createSilentWav(durationSeconds = 1, sampleRate = 16000) {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const dataSize = durationSeconds * sampleRate * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32); // BlockAlign
  buffer.writeUInt16LE(bytesPerSample * 8, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

async function testWhisper() {
  console.log('Testing /api/v1/transcribe with valid WAV audio...');
  const form = new FormData();
  const wavBuffer = createSilentWav(2, 16000);
  form.append('file', wavBuffer, {
    filename: 'voice.wav',
    contentType: 'audio/wav'
  });

  try {
    const res = await axios.post('http://127.0.0.1:8000/api/v1/transcribe', form, {
      headers: form.getHeaders(),
      timeout: 20000
    });
    console.log('[SUCCESS] Python Whisper response:', res.status, res.data);
  } catch (err) {
    console.error('[FAILED] Python Whisper error:', err.response?.status, err.response?.data || err.message);
  }
}

testWhisper();
