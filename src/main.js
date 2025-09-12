/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn, selectAllCoordinateInputs } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.textContent = `(${callback})();`;
    document.documentElement?.appendChild(script);
    script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

const storageTemplates = JSON.parse(GM_getValue('bmTemplates', '{}'));
console.log(storageTemplates);
templateManager.importJSON(storageTemplates); // Loads the templates

const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}')); // Loads the user settings
console.log(userSettings);
console.log(Object.keys(userSettings).length);
if (Object.keys(userSettings).length == 0) {
  const uuid = crypto.randomUUID(); // Generates a random UUID
  console.log(uuid);
  GM.setValue('bmUserSettings', JSON.stringify({
    'uuid': uuid
  }));
}
setInterval(() => apiManager.sendHeartbeat(version), 1000 * 60 * 30); // Sends a heartbeat every 30 minutes

console.log(`Telemetry is ${!(userSettings?.telemetry == undefined)}`);
if ((userSettings?.telemetry == undefined) || (userSettings?.telemetry > 1)) { // Increment 1 to retrigger telemetry notice
  const telemetryOverlay = new Overlay(name, version);
  telemetryOverlay.setApiManager(apiManager); // Sets the API manager for the telemetry overlay
  buildTelemetryOverlay(telemetryOverlay); // Notifies the user about telemetry
}

buildOverlayMain(); // Builds the main overlay

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */

// --- Refactored Overlay GUI Building ---

function buildOverlayMain() {
  // Overlay state tracker (false = maximized, true = minimized)
  let isMinimized = false;
  // Load last saved coordinates (if any)
  let savedCoords = {};
  try { savedCoords = JSON.parse(GM_getValue('bmCoords', '{}')) || {}; } catch (_) { savedCoords = {}; }
  const persistCoords = () => {
    try {
      const tx = Number(document.querySelector('#bm-input-tx')?.value || '');
      const ty = Number(document.querySelector('#bm-input-ty')?.value || '');
      const px = Number(document.querySelector('#bm-input-px')?.value || '');
      const py = Number(document.querySelector('#bm-input-py')?.value || '');
      const data = { tx, ty, px, py };
      GM.setValue('bmCoords', JSON.stringify(data));
    } catch (_) {}
  };

  // --- Section Builders ---

  function buildHeaderSection(overlayMain, name) {
    return overlayMain.addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addImg({'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;'}, 
      (instance, img) => {
        img.addEventListener('click', () => {
        isMinimized = !isMinimized;
        handleMinimizeToggle(isMinimized, instance, img);
        });
      }
      ).buildElement()
      .addHeader(1, {'textContent': name}).buildElement()
      .addP({'textContent': 'PoopGoose variant', 'style': 'margin: 0; font-size: 0.95em; color: #aaa;'}).buildElement()
      .buildElement();
  }

  function buildUserInfoSection(overlayMain) {
    return overlayMain.addDiv({'id': 'bm-contain-userinfo'})
      .addP({'id': 'bm-user-name', 'textContent': 'Username:'}).buildElement()
      .addP({'id': 'bm-user-droplets', 'textContent': 'Droplets:'}).buildElement()
      .addP({'id': 'bm-user-nextlevel', 'textContent': 'Next level in...'}).buildElement()
      .buildElement();
  }

  function buildCoordsSection(overlayMain) {
    return overlayMain.addDiv({'id': 'bm-contain-coords'})
      .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg>'},
        (instance, button) => {
          button.onclick = () => {
            const coords = instance.apiManager?.coordsTilePixel;
            if (!coords?.[0]) {
              instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
              return;
            }
            instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
            instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
            instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
            instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
            persistCoords();
          }
        }
      ).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.tx ?? '')}, (instance, input) => {
        input.addEventListener("paste", (event) => {
          let splitText = (event.clipboardData || window.clipboardData).getData("text").split(" ").filter(n => n).map(Number).filter(n => !isNaN(n));
          if (splitText.length !== 4 ) return;
          let coords = selectAllCoordinateInputs(document); 
          for (let i = 0; i < coords.length; i++) { coords[i].value = splitText[i]; }
          event.preventDefault();
        });
        const handler = () => persistCoords();
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.ty ?? '')}, (instance, input) => {
        const handler = () => persistCoords();
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.px ?? '')}, (instance, input) => {
        const handler = () => persistCoords();
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.py ?? '')}, (instance, input) => {
        const handler = () => persistCoords();
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }).buildElement()
      .buildElement();
  }

  function buildColorFilterSection(overlayMain) {
    return overlayMain.addDiv({'id': 'bm-contain-colorfilter', 'style': 'max-height: 140px; overflow: auto; border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 4px; display: none;'})
      .addDiv({'style': 'display: flex; gap: 6px; margin-bottom: 6px;'})
        .addButton({'id': 'bm-button-colors-enable-all', 'textContent': 'Enable All'}, (instance, button) => {
          button.onclick = () => {
            const t = templateManager.templatesArray[0];
            if (!t?.colorPalette) { return; }
            Object.values(t.colorPalette).forEach(v => v.enabled = true);
            buildColorFilterList();
            instance.handleDisplayStatus('Enabled all colors');
          };
        }).buildElement()
        .addButton({'id': 'bm-button-colors-disable-all', 'textContent': 'Disable All'}, (instance, button) => {
          button.onclick = () => {
            const t = templateManager.templatesArray[0];
            if (!t?.colorPalette) { return; }
            Object.values(t.colorPalette).forEach(v => v.enabled = false);
            buildColorFilterList();
            instance.handleDisplayStatus('Disabled all colors');
          };
        }).buildElement()
      .buildElement()
      .addDiv({'id': 'bm-colorfilter-list'}).buildElement()
      .buildElement();
  }

  function buildTemplateControlsSection(overlayMain, version) {
    return overlayMain.addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-template'})
        .addButton({'id': 'bm-button-enable', 'textContent': 'Enable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
            instance.handleDisplayStatus(`Enabled templates!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-create', 'textContent': 'Create'}, (instance, button) => {
          button.onclick = () => {
            const input = document.querySelector('#bm-input-file-template');
            const coordTlX = document.querySelector('#bm-input-tx');
            if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordTlY = document.querySelector('#bm-input-ty');
            if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxX = document.querySelector('#bm-input-px');
            if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxY = document.querySelector('#bm-input-py');
            if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}
            templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);
            instance.handleDisplayStatus(`Drew to canvas!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-disable', 'textContent': 'Disable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
            instance.handleDisplayStatus(`Disabled templates!`);
          }
        }).buildElement()
      .buildElement()
      .addTextarea({'id': overlayMain.outputStatusId,
                    'placeholder': `Status: Sleeping...\nVersion: ${version}`, 
                    'readOnly': true,
                    'style' : 'width: 380px;'}).buildElement();
  }

  function buildActionButtonsSection(overlayMain) {
    // Create a horizontal flex container
    return overlayMain.addDiv({
        'id': 'bm-contain-buttons-action',
        'style': 'display: flex; flex-direction: row; align-items: flex-end; gap: 12px;'
      })
      // First vertical stack: the two buttons
      .addDiv({'style': 'display: flex; flex-direction: column; gap: 6px;'})
        .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter'}, 
          (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .addButton({'id': 'bm-button-website', 'className': 'bm-help', 'innerHTML': '🌐', 'title': 'Official Blue Marble Website'}, 
          (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://bluemarble.lol/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
      .buildElement()
      // Second vertical stack: the two labels
      .addDiv({'style': 'display: flex; flex-direction: column; gap: 0; justify-content: flex-end;'})
        .addSmall({'textContent': 'Made by SwingTheVine', 'style': 'margin-top: auto;'})
        .buildElement()
        .addSmall({'textContent': 'Edited by PoopGoose', 'style': 'margin-top: 0;'})
        .buildElement()
      .buildElement()
    .buildElement();
  }

  function handleMinimizeToggle(isMinimized, instance, img) {
    const overlay = document.querySelector('#bm-overlay');
    const header = document.querySelector('#bm-contain-header');
    const dragBar = document.querySelector('#bm-bar-drag');
    const coordsContainer = document.querySelector('#bm-contain-coords');
    const coordsButton = document.querySelector('#bm-button-coords');
    const createButton = document.querySelector('#bm-button-create');
    const enableButton = document.querySelector('#bm-button-enable');
    const disableButton = document.querySelector('#bm-button-disable');
    const coordInputs = document.querySelectorAll('#bm-contain-coords input');
    const elementsToToggle = [
      '#bm-overlay h1',
      '#bm-contain-userinfo',
      '#bm-overlay hr',
      '#bm-contain-automation > *:not(#bm-contain-coords)',
      '#bm-input-file-template',
      '#bm-contain-buttons-action',
      `#${instance.outputStatusId}`,
      '#bm-contain-colorfilter'
    ];
    elementsToToggle.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        element.style.display = isMinimized ? 'none' : '';
      });
    });
    if (isMinimized) {
      if (coordsContainer) coordsContainer.style.display = 'none';
      if (coordsButton) coordsButton.style.display = 'none';
      if (createButton) createButton.style.display = 'none';
      if (enableButton) enableButton.style.display = 'none';
      if (disableButton) disableButton.style.display = 'none';
      coordInputs.forEach(input => { input.style.display = 'none'; });
      overlay.style.width = '60px';
      overlay.style.height = '76px';
      overlay.style.maxWidth = '60px';
      overlay.style.minWidth = '60px';
      overlay.style.padding = '8px';
      img.style.marginLeft = '3px';
      header.style.textAlign = 'center';
      header.style.margin = '0';
      header.style.marginBottom = '0';
      if (dragBar) {
        dragBar.style.display = '';
        dragBar.style.marginBottom = '0.25em';
      }
    } else {
      if (coordsContainer) {
        coordsContainer.style.display = '';
        coordsContainer.style.flexDirection = '';
        coordsContainer.style.justifyContent = '';
        coordsContainer.style.alignItems = '';
        coordsContainer.style.gap = '';
        coordsContainer.style.textAlign = '';
        coordsContainer.style.margin = '';
      }
      if (coordsButton) coordsButton.style.display = '';
      if (createButton) { createButton.style.display = ''; createButton.style.marginTop = ''; }
      if (enableButton) { enableButton.style.display = ''; enableButton.style.marginTop = ''; }
      if (disableButton) { disableButton.style.display = ''; disableButton.style.marginTop = ''; }
      coordInputs.forEach(input => { input.style.display = ''; });
      img.style.marginLeft = '';
      overlay.style.padding = '10px';
      header.style.textAlign = '';
      header.style.margin = '';
      header.style.marginBottom = '';
      if (dragBar) dragBar.style.marginBottom = '0.5em';
      overlay.style.width = '';
      overlay.style.height = '';
    }
    img.alt = isMinimized ?
      'Blue Marble Icon - Minimized (Click to maximize)' :
      'Blue Marble Icon - Maximized (Click to minimize)';
  }

  // --- Main Overlay Assembly ---
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px; width: 390px;'});
  buildHeaderSection(overlayMain, name);
  overlayMain.addHr().buildElement();
  buildUserInfoSection(overlayMain);
  overlayMain.addHr().buildElement();
  overlayMain.addDiv({'id': 'bm-contain-automation'});
  buildCoordsSection(overlayMain);
  buildColorFilterSection(overlayMain);
  buildTemplateControlsSection(overlayMain, version);
  buildActionButtonsSection(overlayMain);
  overlayMain.buildOverlay(document.body);

  // ------- Helper: Build the color filter list -------
  window.buildColorFilterList = function buildColorFilterList() {
    const listContainer = document.querySelector('#bm-colorfilter-list');
    const t = templateManager.templatesArray?.[0];
    if (!listContainer || !t?.colorPalette) {
      if (listContainer) { listContainer.innerHTML = '<small>No template colors to display.</small>'; }
      return;
    }
    listContainer.innerHTML = '';
    const entries = Object.entries(t.colorPalette)
      .sort((a,b) => b[1].count - a[1].count);
    for (const [rgb, meta] of entries) {
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.margin = '4px 0';
      let swatch = document.createElement('div');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.border = '1px solid rgba(255,255,255,0.5)';
      let label = document.createElement('span');
      label.style.fontSize = '12px';
      let labelText = `${meta.count.toLocaleString()}`;
      if (rgb === 'other') {
        swatch.style.background = '#888';
        labelText = `Other • ${labelText}`;
      } else if (rgb === '#deface') {
        swatch.style.background = '#deface';
        labelText = `Transparent • ${labelText}`;
      } else {
        const [r, g, b] = rgb.split(',').map(Number);
        swatch.style.background = `rgb(${r},${g},${b})`;
        try {
          const tMeta = templateManager.templatesArray?.[0]?.rgbToMeta?.get(rgb);
          if (tMeta && typeof tMeta.id === 'number') {
            const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
            const starLeft = tMeta.premium ? '★ ' : '';
            labelText = `#${tMeta.id} ${starLeft}${displayName} • ${labelText}`;
          }
        } catch (ignored) {}
      }
      label.textContent = labelText;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !!meta.enabled;
      toggle.addEventListener('change', () => {
        meta.enabled = toggle.checked;
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
        try {
          const t = templateManager.templatesArray?.[0];
          const key = t?.storageKey;
          if (t && key && templateManager.templatesJSON?.templates?.[key]) {
            templateManager.templatesJSON.templates[key].palette = t.colorPalette;
            GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
          }
        } catch (_) {}
      });
      row.appendChild(toggle);
      row.appendChild(swatch);
      row.appendChild(label);
      listContainer.appendChild(row);
    }
  };

  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try { buildColorFilterList(); } catch (_) {}
    }
  });
  setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        const colorUI = document.querySelector('#bm-contain-colorfilter');
        if (colorUI) { colorUI.style.display = ''; }
        buildColorFilterList();
      }
    } catch (_) {}
  }, 0);
}

function buildTelemetryOverlay(overlay) {
  overlay.addDiv({'id': 'bm-overlay-telemetry', style: 'top: 0px; left: 0px; width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh; z-index: 9999;'})
    .addDiv({'id': 'bm-contain-all-telemetry', style: 'display: flex; flex-direction: column; align-items: center;'})
      .addDiv({'id': 'bm-contain-header-telemetry', style: 'margin-top: 10%;'})
        .addHeader(1, {'textContent': `${name} Telemetry`}).buildElement()
      .buildElement()

      .addDiv({'id': 'bm-contain-telemetry', style: 'max-width: 50%; overflow-y: auto; max-height: 80vh;'})
        .addHr().buildElement()
        .addBr().buildElement()
        .addDiv({'style': 'width: fit-content; margin: auto; text-align: center;'})
        .addButton({'id': 'bm-button-telemetry-more', 'textContent': 'More Information'}, (instance, button) => {
          button.onclick = () => {
            window.open('https://github.com/SwingTheVine/Wplace-TelemetryServer#telemetry-data', '_blank', 'noopener noreferrer');
          }
        }).buildElement()
        .buildElement()
        .addBr().buildElement()
        .addDiv({style: 'width: fit-content; margin: auto; text-align: center;'})
          .addButton({'id': 'bm-button-telemetry-enable', 'textContent': 'Enable Telemetry', 'style': 'margin-right: 2ch;'}, (instance, button) => {
            button.onclick = () => {
              const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}'));
              userSettings.telemetry = 1;
              GM.setValue('bmUserSettings', JSON.stringify(userSettings));
              const element = document.getElementById('bm-overlay-telemetry');
              if (element) {
                element.style.display = 'none';
              }
            }
          }).buildElement()
          .addButton({'id': 'bm-button-telemetry-disable', 'textContent': 'Disable Telemetry'}, (instance, button) => {
            button.onclick = () => {
              const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}'));
              userSettings.telemetry = 0;
              GM.setValue('bmUserSettings', JSON.stringify(userSettings));
              const element = document.getElementById('bm-overlay-telemetry');
              if (element) {
                element.style.display = 'none';
              }
            }
          }).buildElement()
        .buildElement()
        .addBr().buildElement()
        .addP({'textContent': 'We collect anonymous telemetry data such as your browser, OS, and script version to make the experience better for everyone. The data is never shared personally. The data is never sold. You can turn this off by pressing the \'Disable\' button, but keeping it on helps us improve features and reliability faster. Thank you for supporting the Blue Marble!'}).buildElement()
        .addP({'textContent': 'You can disable telemetry by pressing the "Disable" button below.'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);
}

function buildOverlayTabTemplate() {
  overlayTabTemplate.addDiv({'id': 'bm-tab-template', 'style': 'top: 20%; left: 10%;'})
      .addDiv()
        .addDiv({'className': 'bm-dragbar'}).buildElement()
        .addButton({'className': 'bm-button-minimize', 'textContent': '↑'},
          (instance, button) => {
            button.onclick = () => {
              let isMinimized = false;
              if (button.textContent == '↑') {
                button.textContent = '↓';
              } else {
                button.textContent = '↑';
                isMinimized = true;
              }

              
            }
          }
        ).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay();
}
