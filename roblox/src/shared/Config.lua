--[=[
	Night 99 -- shared tuning table.

	Values are ported from the Unity project (Assets/Scripts/GameParameters.cs)
	and re-tuned for Roblox units (studs, seconds). Everything you are likely to
	want to change lives in this file.
]=]

local Config = {}

Config.Game = {
	Name = "Night 99",
	MonsterName = "THE NIGHTMAN",
}

Config.Map = {
	HalfExtent = 128, -- matches the barriers in generated/Forest.rbxmx
	MonsterSpawn = Vector3.new(-116, 3, -116),
}

Config.Player = {
	WalkSpeed = 16,
	Health = 100,
	RespawnDelay = 5,
	HumanoidScale = 2, -- the monster is built at ~8 studs tall
}

-- Defaults to first person, which suits a flashlight horror game. Set Mode to
-- "ThirdPerson" for the high orbiting rig the Unity original used
-- (GameParameters.cs had distance 10 / height 15 / smooth speed 5).
Config.Camera = {
	Mode = "FirstPerson",
	Sensitivity = 0.25,
	Distance = 10,
	Height = 15,
	SmoothSpeed = 5,
	FieldOfView = 78,
}

Config.Battery = {
	Max = 100,
	DrainPerSecond = 1.7, -- ~59s of light on Night 1
	DrainGrowthPerNight = 0.14,
	IdleRechargePerSecond = 4, -- trickle back while the flashlight is OFF
	PickupAmount = 40,
	PickupRespawnSeconds = 25,
	SyncInterval = 0.2,
	ToggleCooldown = 0.18,
}

Config.Light = {
	Range = 28,
	Angle = 52,
	Brightness = 3.0,
	DimFactor = 0.3, -- brightness multiplier at 0% charge
	ShrinkFactor = 0.5, -- range multiplier at 0% charge
	ToggleKey = Enum.KeyCode.F,
}

Config.Monster = {
	RoamSpeed = 9,
	ChaseSpeed = 13.5,
	ChaseSpeedPerNight = 0.9,
	MaxChaseSpeed = 24,
	RepelSpeed = 19,
	ChaseRange = 40,
	GiveUpRange = 58,
	RepelRange = 17,
	-- Below this charge the flashlight stops warding it off. This is the whole
	-- tension of the game: the light works, but only while you can pay for it.
	RepelBatteryFactor = 0.34,
	AttackRange = 6,
	AttackDamage = 34,
	AttackCooldown = 1.2,
	HeightOffset = 3,
	NetworkRate = 15,
	RespawnDelay = 7,
}

Config.Round = {
	NightSeconds = 80,
	IntermissionSeconds = 10,
}

return Config