--[=[
	Night 99 server entry point.

	Boot order matters: the wire format exists before anything can fire on it,
	and the map exists before the monster tries to pivot.
]=]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Server = script.Parent

local Net = require(Server:WaitForChild("Net"))
local LightingService = require(Server:WaitForChild("LightingService"))
local PlayerService = require(Server:WaitForChild("PlayerService"))
local MonsterService = require(Server:WaitForChild("MonsterService"))
local BatteryService = require(Server:WaitForChild("BatteryService"))
local NightService = require(Server:WaitForChild("NightService"))

Players.RespawnTime = Config.Player.RespawnDelay

Net.Create()
LightingService.Init()
PlayerService.Init(Config, Net)
MonsterService.Init(Config, Net, PlayerService)
BatteryService.Init(Config, Net, PlayerService)
NightService.Init(Config, MonsterService, PlayerService, Net)

print(string.format("[Night99] booted with %d battery pickups", BatteryService.Count()))