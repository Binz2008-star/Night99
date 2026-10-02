--[=[
	Night clock.

	One night = NightSeconds of hunting, then IntermissionSeconds to scavenge
	batteries before it gets worse. Difficulty is a function of the night
	number, so a session naturally curves into "survive as long as you can".
]=]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local NightService = {}

local config, monster, players, net
local night = 0
local phase = "Intermission"
local timer = 0

local function announce(name, payload)
	for _, player in Players:GetPlayers() do
		if net then
			net.GameEvent:FireClient(player, name, payload)
		end
		players.SetPhase(player, phase, night + 1)
	end
end

local function startIntermission()
	phase = "Intermission"
	timer = config.Round.IntermissionSeconds
	monster.BeginNight()
	announce("NightEnded", { night = night })
end

local function startNight()
	night = night + 1
	phase = "Night"
	timer = config.Round.NightSeconds
	monster.BeginNight()
	announce("NightStarted", { night = night, seconds = timer })
end

function NightService.Init(c, m, p, n)
	config = c
	monster = m
	players = p
	net = n

	night = 0
	phase = "Intermission"
	timer = config.Round.IntermissionSeconds

	RunService.Heartbeat:Connect(function(dt)
		timer = timer - dt

		for _, player in Players:GetPlayers() do
			players.SetNightEndsIn(player, math.max(0, timer))
		end

		if timer > 0 then
			return
		end

		if phase == "Night" then
			startIntermission()
		else
			startNight()
		end
	end)
end

function NightService.Current()
	return night
end

return NightService