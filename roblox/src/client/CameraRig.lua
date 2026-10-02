--[=[
	Camera.

	FirstPerson (the default): Roblox's own camera module already gives native
	first-person look with proper mouse lock, so we deliberately leave it alone
	and only widen the field of view. Driving it ourselves would mean also owning
	mouse lock, which is easy to get wrong.

	ThirdPerson: installs a high orbiting rig that mirrors the Unity original
	(GameParameters.cs had distance 10 / height 15 / smooth speed 5). Enabling
	this unbinds Roblox's "Camera" render step and locks the pointer.
]=]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local CameraRig = {}

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local yaw = 0
local pitch = 0.35
local smoothed = nil

local function isThirdPerson()
	return Config.Camera.Mode == "ThirdPerson"
end

local function installThirdPerson()
	-- We now own the camera, so take it away from the default module.
	RunService:UnbindFromRenderStep("Camera")
	UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
	camera.FieldOfView = Config.Camera.FieldOfView

	local function onStep(dt)
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		local head = character and character:FindFirstChild("Head")
		if not root or not head then
			return
		end

		local delta = UserInputService:GetMouseDelta()
		yaw = yaw - delta.X * Config.Camera.Sensitivity * 0.01
		pitch = math.clamp(
			pitch + delta.Y * Config.Camera.Sensitivity * 0.01,
			-0.6,
			1.1
		)

		local pivot = head.Position
		local rotation = CFrame.Angles(pitch, yaw, 0)
		local offset = rotation:VectorToWorldSpace(Vector3.new(0, Config.Camera.Height, Config.Camera.Distance))
		local target = CFrame.lookAt(pivot + offset, pivot)

		-- Frame-rate independent smoothing, matching cameraSmoothSpeed.
		local alpha = 1 - math.exp(-Config.Camera.SmoothSpeed * dt)
		smoothed = smoothed and smoothed:Lerp(target, alpha) or target
		camera.CFrame = smoothed
	end

	RunService:BindToRenderStep("Night99Camera", Enum.RenderPriority.Camera.Value - 1, onStep)
end

function CameraRig.Init()
	if not isThirdPerson() then
		-- Just widen the FOV a touch for the horror look; leave look controls
		-- to Roblox so mouse lock keeps working.
		camera.FieldOfView = Config.Camera.FieldOfView
		return
	end

	installThirdPerson()

	player.CharacterAdded:Connect(function()
		-- Re-seed the orbit so each life does not start staring at the ground.
		yaw = 0
		pitch = 0.35
		smoothed = nil
	end)
end

return CameraRig