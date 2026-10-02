--[=[
	Flashlight.

	The light is attached to the character's head so it swings with the camera.
	Range and brightness scale with the last battery value the server sent us,
	which is the visual half of the "spend charge or get caught" loop.
]=]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Remote = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Remote"))

local Flashlight = {}

local player = Players.LocalPlayer

local light
local attached = {}

local authoritative = {
	battery = Config.Battery.Max,
	maxBattery = Config.Battery.Max,
	lightOn = false,
}

-- Optimistic local state so the toggle feels instant; the server confirms it.
local pendingLightOn = false
local battery = Config.Battery.Max

function Flashlight.GetBattery()
	return battery
end

function Flashlight.IsOn()
	return authoritative.lightOn or pendingLightOn
end

local function requestToggle()
	pendingLightOn = not Flashlight.IsOn()
	Remote.WaitFor("LightRequest"):FireServer()
end

local function attach(character)
	for _, instance in ipairs(attached) do
		instance:Destroy()
	end
	table.clear(attached)

	local head = character:WaitForChild("Head", 10)
	if not head then
		return
	end

	local spot = Instance.new("SpotLight")
	spot.Name = "NightFlashlight"
	spot.Color = Color3.fromRGB(255, 236, 196)
	spot.Angle = Config.Light.Angle
	spot.Range = Config.Light.Range
	spot.Brightness = Config.Light.Brightness
	spot.Shadows = true
	-- No ShadowSoftness here: that is a Lighting property, not a SpotLight one, and
	-- assigning it throws "not a valid member of SpotLight" at runtime.
	spot.Face = Enum.NormalId.Front
	spot.Parent = head

	-- Faint personal glow so you are never in total blindness at your feet.
	local fill = Instance.new("PointLight")
	fill.Name = "NightFill"
	fill.Color = Color3.fromRGB(190, 200, 225)
	fill.Range = 14
	fill.Brightness = 0.35
	fill.Shadows = false
	fill.Parent = head

	light = spot
	table.insert(attached, spot)
	table.insert(attached, fill)
end

--- Rebuild the light to match the server's view of charge.
local function apply()
	if not light then
		return
	end
	local fraction = math.clamp(battery / Config.Battery.Max, 0, 1)
	local isOn = Flashlight.IsOn() and battery > 0

	light.Enabled = isOn
	light.Range = Config.Light.Range * (Config.Light.ShrinkFactor + (1 - Config.Light.ShrinkFactor) * fraction)
	light.Brightness = Config.Light.Brightness * (Config.Light.DimFactor + (1 - Config.Light.DimFactor) * fraction)
end

function Flashlight.ApplyState(state)
	authoritative = state
	battery = state.battery
	-- Once the server agrees (or corrects us), drop the optimistic value.
	pendingLightOn = state.lightOn
	apply()
end

function Flashlight.Init(net, toggleButton)
	net.State.OnClientEvent:Connect(function(state)
		Flashlight.ApplyState(state)
	end)

	net.GameEvent.OnClientEvent:Connect(function(name)
		if name == "BatteryDepleted" then
			pendingLightOn = false
		end
		apply()
	end)

	attach(player.Character or player.CharacterAdded:Wait())

	player.CharacterAdded:Connect(function(character)
		attach(character)
		apply()
	end)

	UserInputService.InputBegan:Connect(function(input, gameProcessed)
		if gameProcessed then
			return
		end
		if input.KeyCode == Config.Light.ToggleKey then
			requestToggle()
		end
	end)

	-- Mobile fallback: the HUD button fires the same request as the F key.
	if toggleButton then
		toggleButton.InputBegan:Connect(function(input)
			if input.UserInputType == Enum.UserInputType.Touch
				or input.UserInputType == Enum.UserInputType.MouseButton1 then
				requestToggle()
			end
		end)
	end

	RunService.RenderStepped:Connect(apply)
end

return Flashlight