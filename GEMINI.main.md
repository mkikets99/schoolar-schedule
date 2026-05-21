# UI (GitHub Pages / Client Layer)

## 1. General Concept
The UI is a fully client-side SPA application running on GitHub Pages without backend. All heavy scheduling logic is handled by a Web Worker ([GEMINI.worker.md]).

The UI is responsible only for:
- importing/exporting data
- editing school structure
- schedule visualization
- managing generation scenarios
- communication with Web Worker via message-passing

---

## 2. Core UI Modules

### 2.1 Project Manager
- create new project
- open `.schoolproj` file
- autosave to IndexedDB
- local snapshot history
- export/import project

---

### 2.2 Data Editor (Core CRUD)

Entities:
- Schools
- Academic Years
- Groups (classes, subgroups, electives)
- Teachers
- Subjects
- Rooms
- Curriculum rules
- Load distribution (view/edit only)

Functions:
- grid-based editing
- bulk editing
- copy/paste rows
- validation UI

---

### 2.3 Load Distribution UI
- Teacher × Grade/Stream matrix
- fast hour assignment
- overload detection
- draft / approved mode
- filtering by subject

---

### 2.4 Schedule Viewer
- calendar grid (day × time)
- drag & drop lessons
- locked slots
- conflict highlighting
- filtering

---

### 2.5 Constraint Inspector
- conflict list
- explanations
- accept risk / request fix

---

### 2.6 Worker Communication Layer

Sends:
- project state
- constraints
- generation request

Receives:
- schedule result
- conflicts
- optimization suggestions
- progress updates

---

## 3. Worker Interface

===
worker.postMessage({
  type: "GENERATE_SCHEDULE",
  payload: ProjectState
});

worker.onmessage = (event) => {
  switch(event.data.type) {
    case "PROGRESS":
    case "RESULT":
    case "ERROR":
  }
};
===

---

## 4. Data Format
- .schoolproj JSON-based
- schema versioning
- backward compatibility

---

## 5. UX Principles
- offline-first
- instant feedback
- non-blocking UI
- worker-only heavy computation
- minimal clicks

---

## 6. Constraints
- no backend
- no accounts
- no cloud sync
- fully local execution