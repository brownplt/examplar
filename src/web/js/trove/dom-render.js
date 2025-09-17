({
    requires: [],
    nativeRequires: [],
    provides: {
        values: {
            genlayout: ["arrow", [["RawArray", "Any"], "String"], "Any"],
        }
    },
    theModule: function (runtime, namespace, uri) {


        ///// Layout Generation /////
        function genlayout(v, cndSpec, stringsIdempotent=true, numbersIdempotent=true, booleansIdempotent=true, showFunctions=false) {

            const container = document.createElement("div");
            container.style.border = "1px solid #ccc";
            container.style.padding = "5px";
            container.style.margin = "10px 0";
            container.style.position = "relative"; // For positioning elements inside the container

            // Create error message mount point
            const errorDiv = document.createElement("div");
            errorDiv.id = "error-message-container-" + Math.random().toString(36).slice(2);
            container.appendChild(errorDiv);




            let options = {
                /** Whether to make string values idempotent (reuse atoms for same string values) */
                stringsIdempotent: stringsIdempotent,
                /** Whether to make number values idempotent (reuse atoms for same number values) */
                numbersIdempotent: numbersIdempotent,
                /** Whether to make boolean values idempotent (reuse atoms for same boolean values) */
                booleansIdempotent: booleansIdempotent,
                /** Whether to include function/method fields in parsing */
                showFunctions: showFunctions
            }
                            // Start timing the CnDCore logic
            const layoutStartTime = performance.now();

            try {

                
                // CnDCore logic
                const dataInstance = new window.CndCore.PyretDataInstance(v, options, window.__internalRepl);

                const numAtoms = dataInstance.getAtoms().length || 0;
                const numTypes = dataInstance.getTypes().length || 0;
                const numRelations = dataInstance.getRelations().length || 0;


                const evaluationContext = { sourceData: dataInstance };
                const evaluator = new CndCore.Evaluators.SGraphQueryEvaluator();
                evaluator.initialize(evaluationContext);
                const r = dataInstance.reify();
                const pyretDataAsString = String(r);
                const layoutSpec = CndCore.parseLayoutSpec(cndSpec);
                const ENABLE_ALIGNMENT_EDGES = true;
                const instanceNumber = 0;
                const layoutInstance = new CndCore.LayoutInstance(
                    layoutSpec,
                    evaluator,
                    instanceNumber,
                    ENABLE_ALIGNMENT_EDGES
                );
                const projections = {};
                const layoutResult = layoutInstance.generateLayout(dataInstance, projections);
                const currentInstanceLayout = layoutResult.layout;
                
                // End layout generation timing
                const layoutEndTime = performance.now();
                const layoutGenerationTime = layoutEndTime - layoutStartTime;

                // Graph container
                const graphContainer = document.createElement("div");
                graphContainer.style.position = "relative";
                graphContainer.style.marginTop = "10px";
                graphContainer.style.width = "45vw";
                graphContainer.style.height = "60vh";
                graphContainer.style.overflow = "hidden"; // No scrolling within graph container



                // Graph element (initially visible)
                const graphElement = document.createElement("webcola-cnd-graph");
                graphElement.setAttribute("width", "45vw");
                graphElement.setAttribute("height", "60vh");
                graphElement.style.display = "block";
                graphElement.style.margin = "0 auto";
                graphElement.style.width = "45vw";
                graphElement.style.height = "60vh";
                graphElement.style.boxSizing = "border-box";
                graphElement.style.backgroundColor = "#fff";


                // Add the graph element to the graph container
                graphContainer.appendChild(graphElement);

                // Add the graph container to the main container
                container.appendChild(graphContainer);

                // Create reset button for the graph toolbar
                const resetButton = document.createElement("button");
                resetButton.textContent = "Reset Layout";
                resetButton.style.padding = "4px 8px";
                resetButton.style.fontSize = "12px";
                resetButton.style.cursor = "pointer";
                // resetButton.style.border = "1px solid #dc3545";
                resetButton.style.borderRadius = "3px";
                resetButton.style.backgroundColor = "#f8f9fa";
                resetButton.style.color = "#dc3545";
                resetButton.style.marginLeft = "5px";
                resetButton.title = "Reset graph layout to original position";

                // Create "See Pyret Data" button to toggle a horizontally-scrollable text view
                const seeDataButton = document.createElement("button");
                seeDataButton.textContent = "See Pyret Data";
                seeDataButton.style.padding = "4px 8px";
                seeDataButton.style.fontSize = "12px";
                seeDataButton.style.cursor = "pointer";
                seeDataButton.style.borderRadius = "3px";
                seeDataButton.style.backgroundColor = "#f8f9fa";
                seeDataButton.style.color = "#007bff";
                seeDataButton.style.marginLeft = "5px";
                seeDataButton.title = "Show/hide the Pyret data used to generate this graph";

                // Add click handler for reset button
                resetButton.addEventListener("click", () => {
                    console.log("Resetting graph layout");
                    graphElement.renderLayout(currentInstanceLayout).then(() => {
                        console.log("Graph layout reset successfully");
                        // Let SVG handle its own scaling via viewBox
                        const svg = graphElement.shadowRoot?.querySelector('svg');
                        if (svg) {
                            svg.style.width = "100%";
                            svg.style.height = "100%";
                            svg.style.display = "block";
                            if (svg.parentElement) {
                                svg.parentElement.style.overflow = "hidden";
                                svg.parentElement.style.width = "45vw";
                                svg.parentElement.style.height = "65vh";
                            }
                        }

                    }).catch((err) => {
                        console.error("Error resetting graph layout:", err);
                    });
                });

                // Add click handler for See Pyret Data button
                let stringView = null;
                seeDataButton.addEventListener("click", () => {
                    if (stringView && stringView.parentElement) {
                        // If visible, remove it
                        stringView.parentElement.removeChild(stringView);
                        stringView = null;
                        seeDataButton.textContent = "See Pyret Datum";
                        return;
                    }

                    // Create the string view pre element and style it to allow horizontal scrolling only
                    stringView = document.createElement("pre");
                    stringView.textContent = String(r);
                    stringView.style.margin = "0 0 10px 0"; // Spacing between string view and the graph
                    stringView.style.maxHeight = "30vh"; // Prevent it from taking too much vertical space
                    stringView.style.overflowX = "auto"; // Allow horizontal scroll
                    stringView.style.overflowY = "hidden"; // No vertical scroll
                    stringView.style.whiteSpace = "pre"; // Preserve whitespace
                    stringView.style.background = "#fff";
                    stringView.style.border = "1px solid #e9ecef";
                    stringView.style.padding = "8px";
                    stringView.style.boxSizing = "border-box";

                    // Insert the string view above the graph container
                    container.insertBefore(stringView, graphContainer);
                    seeDataButton.textContent = "Hide Pyret Datum";
                });

                // Render the graph layout
                const renderStartTime = performance.now();
                graphElement.renderLayout(currentInstanceLayout).then(() => {
                    const renderEndTime = performance.now();
                    const renderTime = renderEndTime - renderStartTime;


                    const svg = graphElement.shadowRoot?.querySelector('svg');
                    if (svg) {
                        svg.style.width = "100%";
                        svg.style.height = "100%";
                        svg.style.display = "block";
                        if (svg.parentElement) {
                            svg.parentElement.style.overflow = "hidden";
                            svg.parentElement.style.width = "45vw";
                            svg.parentElement.style.height = "65vh";
                        }
                    }
                    
                    // Log the complete dom-render call with all timing data
                    const logPayload = {
                        "v": v,
                        "cndSpec": cndSpec,
                        "options": options,
                        "reifiedData": r,
                        "layoutGenerationTimeMs": layoutGenerationTime,
                        "renderTimeMs": renderTime,
                        "numAtoms": numAtoms,
                        "numTypes": numTypes,
                        "numRelations": numRelations
                    };
                    console.log("dom-render completed with:", logPayload);
                    if (window.cloud_log) {
                        window.cloud_log("dom-render", logPayload);
                    }
                    
                    console.log("Graph layout rendered");

                    // Add the reset button to the graph toolbar after rendering
                    graphElement.addToolbarControl(resetButton);
                    // Add the See Pyret Data button to the toolbar as well
                    graphElement.addToolbarControl(seeDataButton);

                    // Mount additional React components after rendering
                    if (window.mountErrorMessageModal) {
                        console.log("Mounting Error Message Modal");
                        window.mountErrorMessageModal(errorDiv.id);
                    }
                }).catch((err) => {
                    const renderEndTime = performance.now();
                    const renderTime = renderEndTime - renderStartTime;
                    
                    // Log even on error with timing data
                    const logPayload = {
                        "v": v,
                        "cndSpec": cndSpec,
                        "options": options,
                        "reifiedData": r,
                        "layoutGenerationTimeMs": layoutGenerationTime,
                        "renderTimeMs": renderTime,
                        "renderError": err.message || err.toString(),
                    };
                    console.log("dom-render failed with:", logPayload);
                    if (window.cloud_log) {
                        window.cloud_log("dom-render-error", logPayload);
                    }
                    
                    console.error("Error rendering graph layout:", err);
                });

            } catch (error) {
                const layoutEndTime = performance.now();
                const layoutGenerationTime = layoutEndTime - layoutStartTime;
                
                // Log the error with timing data
                const logPayload = {
                    "v": v,
                    "cndSpec": cndSpec,
                    "options": options,
                    "reifiedData": null, // Can't reify if there was an error
                    "layoutGenerationTimeMs": layoutGenerationTime,
                    "renderTimeMs": null, // Never got to rendering
                    "layoutError": error.message || error.toString(),
                    "numAtoms": numAtoms,
                    "numTypes": numTypes,
                    "numRelations": numRelations
                };
                console.log("dom-render layout failed with:", logPayload);
                if (window.cloud_log) {
                    window.cloud_log("dom-render-layout-error", logPayload);
                }
                
                console.error("Error in genlayout:", error);

                // Display the error in the errorDiv
                errorDiv.style.color = "red";
                errorDiv.style.padding = "10px";
                errorDiv.style.border = "1px solid red";
                errorDiv.style.marginBottom = "10px";
                errorDiv.textContent = `Error: ${error.message || error}`;
            }

            return container;
        }


        /***** Input FROM a layout. This is still experimental and so hidden behind a key-binding. ********/


        /*** Styling helpers */

        function applyOverlayStyles(overlay) {
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100vw"; // Full width of the viewport
            overlay.style.height = "100vh"; // Full height of the viewport
            overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)"; // Semi-transparent background
            overlay.style.zIndex = "10000"; // Ensure it appears above other elements
            overlay.style.display = "flex";
            overlay.style.justifyContent = "center";
            overlay.style.alignItems = "center";
        }

        function applyContainerStyles(container) {
            container.style.background = "white";
            container.style.border = "1px solid #ccc";
            container.style.padding = "20px";
            container.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
            container.style.width = "80vw";
            container.style.borderRadius = "8px";
            container.style.maxHeight = "90vh"; // Limit the height to 90% of the viewport
            container.style.overflowY = "auto"; // Enable vertical scrolling if content overflows
        }

        function applyButtonContainerStyles(buttonContainer) {
            buttonContainer.style.display = "flex";
            buttonContainer.style.justifyContent = "flex-end";
        }
        /********** */


        const INPUT_KEYBINDING = "Ctrl-Alt-I";

        // This is the main function for input mode.
        function geninput(dataInstance, cndSpec) {
            return new Promise((resolve, reject) => {
                // Create the overlay container
                const overlay = document.createElement("div");
                applyOverlayStyles(overlay);

                // Create the input container
                const container = document.createElement("div");
                applyContainerStyles(container);

                // TODO: This seems superfluous from a text standpoint.
                const title = document.createElement("h3");
                title.textContent = "Input";
                title.style.marginTop = "0";
                container.appendChild(title);

                // Create the input area
                const combinedInputDiv = document.createElement("div");
                combinedInputDiv.id = "combined-input-container-" + Math.random().toString(36).slice(2);
                combinedInputDiv.style.overflow = "auto";
                combinedInputDiv.style.marginBottom = "10px";
                container.appendChild(combinedInputDiv);

                // Add buttons
                const buttonContainer = document.createElement("div");
                applyButtonContainerStyles(buttonContainer);


                // These should be better styled, and maybe at the top?
                const doneButton = document.createElement("button");
                doneButton.innerText = "Done";
                doneButton.style.marginRight = "10px";

                const cancelButton = document.createElement("button");
                cancelButton.innerText = "Cancel";

                buttonContainer.appendChild(doneButton);
                buttonContainer.appendChild(cancelButton);
                container.appendChild(buttonContainer);

                // Append the container to the overlay
                overlay.appendChild(container);
                document.body.appendChild(overlay);

                // Cancel button functionality
                cancelButton.onclick = () => {
                    document.body.removeChild(overlay);
                    reject("cancelled");
                };

                // Done button functionality
                doneButton.onclick = () => {
                    try {
                        if (!dataInstance || typeof dataInstance.reify !== "function") {
                            throw new Error("dataInstance.reify() is not available");
                        }
                        const result = dataInstance.reify();
                        document.body.removeChild(overlay);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                };

                // Initialize the input logic
                try {
                    const pyretREPLInternal = window.__internalRepl;

                    const success = CndCore.mountCombinedInput({
                        containerId: combinedInputDiv.id,
                        cndSpec: cndSpec,
                        dataInstance: dataInstance,
                        pyretEvaluator: pyretREPLInternal,
                        height: '100%', // Ensure the combined input spans the full height of the container
                        showLayoutInterface: false,
                        autoApplyLayout: true,
                        onInstanceChange: () => { },
                        onSpecChange: () => { console.log("Spec changed"); },
                        onLayoutApplied: () => { console.log("Layout applied successfully"); },
                    });

                    if (!success) {
                        throw new Error("Failed to mount combined input");
                    }
                } catch (err) {
                    container.textContent = `Error: ${err.message || err}`;
                    reject(err);
                }
            });
        }

        /**
         * Attaches a keybinding to the active CodeMirror instance and executes a thunk when triggered.
         *
         * @param {string} keyBinding - The keybinding to attach (e.g., "Cmd-Shift-R").
         * @param {function} thunk - A function that returns a string or a promise of a string.
         *                           The result of the thunk will replace the text at the cursor.
         *
         * @example
         * // Define a thunk that returns a string
         * function exampleThunk() {
         *     return "Hello, CodeMirror!";
         * }
         *
         * // Attach the keybinding to CodeMirror
         * attachToCM("Cmd-Shift-R", exampleThunk);
         */
        function attachToCM(keyBinding, thunk) {
            // Step 1: Find the active CodeMirror instance
            const cmEl = document.activeElement.closest(".CodeMirror") || document.querySelector(".CodeMirror");
            const cm = cmEl?.CodeMirror;

            if (!cm) {
                console.warn("❌ No CodeMirror editor found.");
                return;
            }

            // Step 2: Add the keybinding using addKeyMap
            const keyMap = {
                [keyBinding]: async function (cmInstance) {
                    try {
                        // Call the thunk to get the result (string or promise of a string)
                        const result = await thunk();

                        // Replace the text at the cursor with the result (only if the promise resolves)
                        if (result !== undefined && result !== null) {
                            cmInstance.replaceSelection(result);
                        }
                    } catch (err) {
                        if (err === "cancelled") {
                            console.log("Operation cancelled by the user. No changes made.");
                        } else {
                            console.error("Error in thunk execution:", err);
                        }
                    }
                }
            };
            cm.addKeyMap(keyMap);
        }


        attachToCM(INPUT_KEYBINDING, async () => {
            try {
                const cmEl = document.activeElement.closest(".CodeMirror") || document.querySelector(".CodeMirror");
                const cm = cmEl?.CodeMirror;
                if (!cm) throw new Error("No active CodeMirror instance");

                const cursorCoords = cm.cursorCoords(true, "page");

                let cndSpec = "";
                let dataInstance = undefined;
                const selectedText = cm.getSelection();
                if (selectedText != null && selectedText !== undefined && selectedText !== "") {
                    // If there IS selected text, we should use that to build the data instance, by passing
                    // it to the evaluator.
                    function removeOuterQuotes(str) {
                        // Check if the string starts and ends with quotes
                        if (str.startsWith('"') && str.endsWith('"')) {
                            // Remove the outermost quotes
                            return str.slice(1, -1);
                        }
                        return str; // Return the string unchanged if no outer quotes
                    }

                    let cndSpecExpr = `(${selectedText})._cndspec()`;
                    let intermediatePyretDataInst = await window.CndCore.PyretDataInstance.fromExpression(cndSpecExpr, false, window.__internalRepl);
                    // Get the CnD spec from the selected text. This is super hacky, may be better to actually begin with the 
                    // EVALUATION of the selected text.
                    cndSpec = removeOuterQuotes(intermediatePyretDataInst.reify());


                    dataInstance = await window.CndCore.PyretDataInstance.fromExpression(selectedText, false, window.__internalRepl);
                } else {
                    // Else, we create a new data instance with no value.
                    dataInstance = new window.CndCore.PyretDataInstance(null, false, window.__internalRepl);
                }

                const result = await geninput(dataInstance, cndSpec, cursorCoords);
                return result;
                //return JSON.stringify(result, null, 2);
            } catch (err) {
                console.error("Error invoking geninput:", err);
                return "#Error: " + (err.message || err);
            }
        });


        return runtime.makeModuleReturn({
            genlayout: runtime.makeFunction(genlayout)
        }, {});
    }
})