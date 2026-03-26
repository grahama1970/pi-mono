To design the interaction model for Binary Explorer, I’ll reference Neo4j Bloom’s behavior while addressing the specific challenges of your tool. Here’s a detailed, implementable set of rules for each interaction:

---

### **1. Click a Node in the Graph**
**Behavior:**
- **Nodes Added:** Only the clicked node is added to the scene (if not already present).
- **Edges Shown:** All edges connected to the clicked node are shown, but only if their endpoints (neighbors) are already in the scene. If a neighbor is not in the scene, the edge is not shown.
- **Selection:** The clicked node is highlighted (e.g., white border, 100% opacity).
- **Dimming:** All other nodes and edges are dimmed (e.g., opacity reduced to 30%).
- **Animation:** A smooth transition (e.g., 300ms) for edge visibility and dimming.

**Why:** This ensures the user sees the context of the clicked node without overwhelming them with new nodes.

---

### **2. Click "Expand" (Right-Click Menu)**
**Behavior:**
- **Nodes Added:** Add the clicked node’s **first 6 neighbors** (sorted by degree, lowest first) to the scene. If there are more than 6 neighbors, show a tooltip: “6 of 59 neighbors shown. Click ‘Expand All’ to see more.”
- **Edges Shown:** All edges between the clicked node and its newly added neighbors are shown.
- **Selection:** The clicked node remains highlighted.
- **Dimming:** No additional dimming beyond what’s already applied from clicking the node.
- **Animation:** New nodes and edges fade in (e.g., 300ms).

**Why:** Capping at 6 neighbors prevents overwhelming the scene while giving the user a manageable subset. Sorting by degree ensures less-connected nodes (which are often more meaningful) are shown first.

---

### **3. Click a Feature Name in the Data Panel**
**Behavior:**
- **Navigation:** If the feature’s node is already in the scene, the graph pans/zooms to focus on it and highlights it (e.g., white border, 100% opacity).
- **Adding to Scene:** If the feature’s node is not in the scene, it is added, and its immediate neighbors (up to 6, as in the "Expand" rule) are also added.
- **Parameters:** If the feature is a parameter, add its parent schema/RPC node and the has_parameter edge. Do not add other parameters unless explicitly requested.
- **Dimming:** All other nodes and edges are dimmed (e.g., opacity reduced to 30%).
- **Animation:** Smooth pan/zoom and fade-in for new nodes and edges.

**Why:** This ensures the data panel and graph remain tightly coupled without overwhelming the scene with parameters.

---

### **4. "Seed: Namespaces" Button**
**Behavior:**
- **Nodes Added:** Add all namespace nodes (4-5) to the scene.
- **Edges Shown:** No edges are shown initially.
- **Selection:** No nodes are selected.
- **Dimming:** No dimming.
- **Animation:** Namespace nodes fade in (e.g., 300ms).

**Why:** This provides a clean starting point for exploration without unnecessary clutter.

---

### **5. "Show All" Button**
**Behavior:**
- **Nodes Added:** Add all 166 non-parameter nodes to the scene. Do not add parameter nodes unless explicitly requested.
- **Edges Shown:** Show all edges between the nodes in the scene.
- **Selection:** No nodes are selected.
- **Dimming:** No dimming.
- **Animation:** Nodes and edges fade in (e.g., 500ms).

**Why:** This gives users a complete overview of the graph while avoiding the noise of parameter nodes.

---

### **6. Removing Nodes**
**Behavior:**
- **Individual Removal:** Right-click a node → “Remove from Scene.” The node and its edges are removed.
- **Cluster Removal:** Right-click a node → “Remove Cluster.” The node, its neighbors, and their edges are removed.
- **Reset:** A “Reset Scene” button removes all nodes and edges, returning to the empty state.
- **Animation:** Removed nodes and edges fade out (e.g., 300ms).

**Why:** This gives users fine-grained control over the scene, preventing clutter.

---

### **7. The "Clutter Problem"**
**Behavior:**
- **Auto-Culling:** After 50 nodes are in the scene, the least recently interacted-with nodes (and their edges) are automatically removed to keep the scene manageable. Show a toast notification: “Older nodes removed to reduce clutter.”
- **Manual Culling:** Users can manually remove nodes or clusters as described above.
- **Animation:** Removed nodes and edges fade out (e.g., 300ms).

**Why:** This mimics Neo4j Bloom’s approach to maintaining a clean, usable graph.

---

### **Summary of Rules**
| **Interaction**            | **Nodes Added/Removed**                          | **Edges Shown/Hidden**                          | **Dimming**                | **Animation**                |
|-----------------------------|--------------------------------------------------|------------------------------------------------|----------------------------|------------------------------|
| Click a Node                | Clicked node (if not present)                   | All edges with endpoints in scene              | Dim non-selected (30%)     | Smooth transitions (300ms)   |
| Expand (Right-Click)        | First 6 neighbors (sorted by degree)            | Edges to new neighbors                         | None                       | Fade in (300ms)              |
| Click Feature in Data Panel | Feature node + 6 neighbors                      | Edges to new neighbors                         | Dim non-selected (30%)     | Pan/zoom + fade in (300ms)   |
| Seed: Namespaces            | All namespace nodes                             | None                                           | None                       | Fade in (300ms)              |
| Show All                    | All non-parameter nodes                         | All edges between nodes in scene               | None                       | Fade in (500ms)              |
| Remove Nodes                | Individual or cluster removed                   | Edges to removed nodes                         | None                       | Fade out (300ms)             |
| Auto-Culling                | Remove least recently interacted nodes (>50)    | Edges to removed nodes                         | None                       | Fade out (300ms)             |

---

This model balances progressive disclosure with usability, ensuring users can explore the graph without being overwhelmed.
