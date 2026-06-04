# Unity 3D Setup Guide for Night 99

Follow these steps in Unity Editor to convert your 2D project to 3D.

## Step 1: Switch from URP 2D to URP 3D

1. Open Unity Editor
2. Go to **Window > Package Manager**
3. Select **Unity Registry** from the dropdown
4. Find **Universal RP** and click **Install** if not already installed
5. Go to **Project Settings > Graphics**
6. Add **Universal Render Pipeline Asset** (3D) to your Scriptable Render Pipeline Settings
7. If you have a 2D URP asset, create a new one:
   - Right-click in Project window > Create > Rendering > URP Asset (with Universal Renderer)
   - Name it `URP_3D_Asset`
   - Select it in Project Settings > Graphics

## Step 2: Create New 3D Scene

1. Go to **File > New Scene**
2. Select **3D** template (or Basic)
3. Save as `Assets/Scenes/Night99_3D.unity`

## Step 3: Create Player GameObject

1. In Hierarchy, right-click > **3D Object > Capsule** (or Cube)
2. Name it `Player`
3. Set Position to (0, 1, 0)
4. Add Tag: Select Player > Inspector > Tag dropdown > Select "Player" (or create new tag "Player")

### Add Components to Player:

**Option A: Using Rigidbody (Physics-based)**
1. Select Player
2. In Inspector, click **Add Component**
3. Search and add **Rigidbody**
4. In Rigidbody settings:
   - Use Gravity: **True**
   - Constraints: Freeze Rotation X, Y, Z
5. Add **Capsule Collider** (if not already there)
6. Add Component > **PlayerMovement** (your script)
7. Add Component > **BatterySystem** (your script)

**Option B: Using CharacterController (Better for movement)**
1. Select Player
2. Add Component > **CharacterController**
3. In CharacterController settings:
   - Height: 2
   - Radius: 0.5
   - Center: (0, 1, 0)
4. Add Component > **PlayerMovement** (your script)
5. Add Component > **BatterySystem** (your script)

## Step 4: Add Light to Player

1. Select Player GameObject
2. Right-click on Player in Hierarchy > **Light > Point Light**
3. This creates a child light object
4. Select the Point Light
5. In Inspector:
   - Range: 20
   - Intensity: 10
   - Color: Yellow/Orange (warm light)
6. In BatterySystem script (on Player):
   - Drag the Point Light into the `playerLight` field

## Step 5: Setup Camera

1. Find the **Main Camera** in Hierarchy
2. Select it
3. In Inspector:
   - Position: (0, 15, -10)
   - Rotation: (60, 0, 0) - looking down at angle
4. Add Component > **CameraController** (your script)
5. In CameraController:
   - Target: Drag Player GameObject here
   - GameParameters: Leave empty for now (we'll create later)

## Step 6: Create Monster

1. In Hierarchy, right-click > **3D Object > Sphere**
2. Name it `Monster`
3. Set Position to (10, 1, 10)
4. Set Scale to (1.5, 1.5, 1.5)
5. Add Component > **Rigidbody**
6. In Rigidbody:
   - Use Gravity: **False** (monster floats/moves)
   - Constraints: Freeze Rotation X, Y, Z
7. Add Component > **Sphere Collider**
8. Add Component > **MonsterAI** (your script)
9. In MonsterAI:
   - Player: Drag Player GameObject here
   - Player Light: Drag Player's Point Light here
   - GameParameters: Leave empty for now

## Step 7: Create Ground

1. In Hierarchy, right-click > **3D Object > Plane**
2. Name it `Ground`
3. Set Position to (0, 0, 0)
4. Set Scale to (50, 1, 50) - large ground area
5. In Inspector, change Material to something dark (forest floor)

## Step 8: Create GameParameters Asset

1. In Project window, right-click > **Create > Game > Game Parameters**
2. Name it `Night99Parameters`
3. Select it in Inspector
4. Adjust values as needed:
   - Player Speed: 5
   - Battery Drain Speed: 10
   - Light Range: 20
   - Monster Speed: 3
   - Camera Distance: 10
   - Camera Height: 15
5. Drag this asset to:
   - Player > PlayerMovement > GameParameters
   - Player > BatterySystem > GameParameters
   - Monster > MonsterAI > GameParameters
   - Camera > CameraController > GameParameters

## Step 9: Add GameManager

1. In Hierarchy, right-click > **Create Empty**
2. Name it `GameManager`
3. Add Component > **GameManager** (your script)
4. Set Position to (0, 0, 0)

## Step 10: Add Fog (Atmosphere)

1. Go to **Window > Rendering > Lighting**
2. Click on the **Environment** tab
3. Check **Fog**
4. Set:
   - Fog Color: Dark gray or black
   - Fog Mode: Exponential
   - Fog Density: 0.02

## Step 11: Add Trees (Optional)

1. In Hierarchy, right-click > **3D Object > Cylinder**
2. Name it `Tree`
3. Set Scale: (0.5, 3, 0.5) - trunk
4. Right-click on Tree > **3D Object > Sphere**
5. Name the sphere `Leaves`
6. Set Position: (0, 2, 0)
7. Set Scale: (2, 2, 2)
8. Change color to green
9. Select both Tree and Leaves, right-click > **Create Empty Parent**
10. Name the parent `Tree_Prefab`
11. Drag `Tree_Prefab` to Project window to create a prefab
12. Delete from Hierarchy
13. Drag prefab from Project to Hierarchy multiple times to place trees

## Step 12: Save Scene

1. **File > Save** or Ctrl+S
2. Make sure scene is saved as `Night99_3D.unity`

## Step 13: Test

1. Click **Play** button
2. Use WASD or Arrow keys to move
3. Monster should chase you when in darkness
4. Monster should flee when near your light
5. Battery should drain over time

## Troubleshooting

**Player falls through ground:**
- Make sure Player has Collider (Capsule Collider or CharacterController)
- Make sure Ground has Mesh Collider (default on Plane)

**Camera doesn't follow:**
- Make sure CameraController script is on Main Camera
- Make sure Target is set to Player GameObject
- Check console for errors

**Monster doesn't move:**
- Make sure Rigidbody is added
- Make sure Use Gravity is False (for floating monster)
- Check that Player reference is set in MonsterAI

**Light doesn't work:**
- Make sure PointLight is child of Player
- Make sure BatterySystem has playerLight reference
- Check that Light is enabled

**Scripts missing:**
- Make sure all .cs files are in `Assets/Scripts` folder
- Unity should auto-compile when you save scripts
- Check console for compilation errors
