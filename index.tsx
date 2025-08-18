/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI} from '@google/genai';
import {applyPalette, GIFEncoder, quantize} from 'gifenc';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
const fps = 4;

// DOM elements
const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const generateButton = document.getElementById(
  'generate-button',
) as HTMLButtonElement;
const framesContainer = document.getElementById(
  'frames-container',
) as HTMLDivElement;
const resultContainer = document.getElementById(
  'result-container',
) as HTMLDivElement;
const statusDisplay = document.getElementById(
  'status-display',
) as HTMLDivElement;
const generationContainer = document.querySelector(
  '.generation-container',
) as HTMLDivElement;
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

// Settings Panel Elements
const settingsToggle = document.getElementById(
  'settings-toggle',
) as HTMLButtonElement;
const settingsPanel = document.getElementById(
  'settings-panel',
) as HTMLDivElement;
const closeSettingsButton = document.getElementById(
  'close-settings-button',
) as HTMLButtonElement;
const systemOrchestratorInstructionInput = document.getElementById(
  'system-orchestrator-instruction',
) as HTMLTextAreaElement;
const aiSupervisorInstructionInput = document.getElementById(
  'ai-supervisor-instruction',
) as HTMLTextAreaElement;

function parseError(error: string) {
  const regex = /{"error":(.*)}/gm;
  const m = regex.exec(error);
  try {
    const e = m[1];
    const err = JSON.parse(e);
    return err.message;
  } catch (e) {
    return error;
  }
}

async function createGifFromPngs(
  imageUrls: string[],
  targetWidth = 1024,
  targetHeight = 1024,
) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }
  const gif = GIFEncoder();
  const fpsInterval = 1 / fps;
  const delay = fpsInterval * 1000;

  for (const url of imageUrls) {
    const img = new Image();
    img.src = url;
    await new Promise((resolve) => {
      img.onload = resolve;
    });
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.fillStyle = '#ffffff';
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const data = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
    const format = 'rgb444';
    const palette = quantize(data, 256, {format});
    const index = applyPalette(data, palette, format);
    gif.writeFrame(index, targetWidth, targetHeight, {palette, delay});
  }

  gif.finish();
  const buffer = gif.bytesView();
  const blob = new Blob([buffer], {type: 'image/gif'});
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img;
}

function updateStatus(message: string) {
  if (statusDisplay) {
    statusDisplay.textContent = message;
  }
}

function switchTab(targetTab: string) {
  tabButtons.forEach((button) => {
    if (button.getAttribute('data-tab') === targetTab) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
  tabContents.forEach((content) => {
    if (content.id === `${targetTab}-content`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  if (targetTab === 'output' && resultContainer) {
    resultContainer.style.display = 'flex';
  }
}

async function run(value: string) {
  if (framesContainer) framesContainer.textContent = '';
  if (resultContainer) resultContainer.textContent = '';
  resultContainer?.classList.remove('appear');
  switchTab('frames');
  if (resultContainer) resultContainer.style.display = 'none';

  updateStatus('Generating frames...');
  if (generateButton) {
    generateButton.disabled = true;
    generateButton.classList.add('loading');
  }

  try {
    const systemInstruction = systemOrchestratorInstructionInput.value;
    const expandPromptResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: value,
      config: {
        temperature: 1,
        systemInstruction,
      },
    });

    const expandedPrompt = expandPromptResponse.text;
    const frameGenInstructionTemplate = aiSupervisorInstructionInput.value;

    const images = [];
    const totalFrames = 8; // Generate 8 frames
    const seed = Math.floor(Math.random() * 1000000); // Generate a random seed for this run

    for (let i = 0; i < totalFrames; i++) {
      const currentFrame = i + 1;
      updateStatus(`Generating frame ${currentFrame} of ${totalFrames}`);
      const frameGenContents = frameGenInstructionTemplate
        .replace('{{prompt}}', expandedPrompt)
        .replace('{{frame_number}}', currentFrame.toString())
        .replace('{{total_frames}}', totalFrames.toString());

      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: frameGenContents,
        config: {
          numberOfImages: 1,
          seed: seed,
          aspectRatio: '1:1',
        },
      });

      if (response.generatedImages && response.generatedImages.length > 0) {
        const imageData = response.generatedImages[0].image.imageBytes;

        if (imageData && framesContainer) {
          // Create a frame element for our UI
          const frameElement = document.createElement('div');
          frameElement.className = 'frame';

          // Create and add the frame number
          const frameNumber = document.createElement('div');
          frameNumber.className = 'frame-number';
          frameNumber.textContent = currentFrame.toString();
          frameElement.appendChild(frameNumber);

          // Create the image
          const src = `data:image/png;base64,${imageData}`;
          const img = document.createElement('img');
          img.width = 1024;
          img.height = 1024;
          img.src = src;

          // Add it to our frame element
          frameElement.appendChild(img);
          framesContainer.appendChild(frameElement);

          // Store URL for GIF creation
          images.push(src);

          // Animate the frame appearance
          setTimeout(() => {
            frameElement.classList.add('appear');
          }, 50);
        }
      } else {
        throw new Error(`Failed to generate frame ${currentFrame}`);
      }
    }

    if (images.length < 2) {
      updateStatus('Failed to generate enough frames. Try another prompt.');
      return false;
    }

    // Update status
    updateStatus('Creating GIF...');

    // Create the GIF
    const img = await createGifFromPngs(images);
    img.className = 'result-image';

    // Clear and add to result container
    if (resultContainer) {
      resultContainer.appendChild(img);

      // Add download button
      const downloadButton = document.createElement('button');
      downloadButton.className = 'download-button';
      const icon = document.createElement('i');
      icon.className = 'fas fa-download';
      downloadButton.appendChild(icon);
      downloadButton.onclick = () => {
        const a = document.createElement('a') as HTMLAnchorElement;
        a.href = img.src;
        a.download = 'magical-animation.gif';
        a.click();
      };
      resultContainer.appendChild(downloadButton);

      switchTab('output');
      setTimeout(() => {
        resultContainer.classList.add('appear');
        generationContainer.scrollIntoView({behavior: 'smooth'});
      }, 50);
    }

    updateStatus('Done!');
  } catch (error) {
    const msg = parseError(String(error));
    console.error('Error generating animation:', error);
    updateStatus(`Error generating animation: ${msg}`);
    return false;
  } finally {
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.classList.remove('loading');
    }
  }
  return true;
}

// Initialize the app
function main() {
  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      if (promptInput) {
        const value = promptInput.value.trim();
        if (value) {
          const retries = 3;
          for (let i = 0; i < retries; i++) {
            if (await run(value)) {
              console.log('Done.');
              return;
            } else {
              console.log(`Retrying...`);
            }
          }
          console.log('Giving up :(');
          updateStatus('Failed to generate after multiple retries. Please try a different prompt.');
        }
      }
    });
  }

  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        generateButton?.click();
      }
    });
    promptInput.addEventListener('focus', (e) => {
      promptInput.select();
      e.preventDefault();
    });
  }

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  // Settings Panel Logic
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      settingsPanel?.classList.toggle('open');
    });
  }
  if (closeSettingsButton) {
    closeSettingsButton.addEventListener('click', () => {
      settingsPanel?.classList.remove('open');
    });
  }

  switchTab('frames');
}

main();
