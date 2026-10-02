--[=[
	Applies the horror look from code so it stays tweakable without a rebuild.

	Lighting.Technology cannot be set from a script, so set that once in Studio
	(Properties > Lighting > Technology > Future or ShadowMap). Everything below
	is scriptable and runs on both server and client.
]=]

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local LightingService = {}

LightingService.MOON = Color3.fromRGB(126, 142, 176)
LightingService.EMBER = Color3.fromRGB(255, 132, 56)

local function ensure(className, name, props)
	local existing = Lighting:FindFirstChildOfClass(className)
	if existing then
		existing:Destroy()
	end
	local instance = Instance.new(className)
	instance.Name = name
	for key, value in props do
		instance[key] = value
	end
	instance.Parent = Lighting
	return instance
end

function LightingService.Init()
	-- Midnight, cold and barely lit.
	Lighting.ClockTime = 0.4
	Lighting.Brightness = 1.0
	Lighting.Ambient = Color3.fromRGB(18, 21, 30)
	Lighting.OutdoorAmbient = Color3.fromRGB(14, 17, 26)
	Lighting.EnvironmentDiffuseScale = 0.4
	Lighting.EnvironmentSpecularScale = 0.6
	Lighting.GlobalShadows = true
	Lighting.ShadowSoftness = 0.2

	-- Fog is what actually sells "you cannot see far enough".
	Lighting.FogColor = Color3.fromRGB(11, 13, 18)
	Lighting.FogStart = 30
	Lighting.FogEnd = Config.Map.HalfExtent * 1.3

	ensure("BloomEffect", "NightBloom", {
		Intensity = 0.6,
		Size = 24,
		Threshold = 0.9,
	})

	ensure("ColorCorrectionEffect", "NightGrade", {
		Brightness = -0.04,
		Contrast = 0.18,
		Saturation = -0.35,
		TintColor = Color3.fromRGB(196, 214, 255),
	})

	ensure("Atmosphere", "NightAtmosphere", {
		Density = 0.32,
		Offset = 0.1,
		Color = Color3.fromRGB(198, 214, 245),
		Decay = Color3.fromRGB(58, 66, 88),
		Haze = 1.4,
	})
end

return LightingService