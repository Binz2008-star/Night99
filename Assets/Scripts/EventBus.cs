using System;
using System.Collections.Generic;

public static class EventBus
{
    private static Dictionary<Type, List<Delegate>> eventHandlers = new Dictionary<Type, List<Delegate>>();

    public static void Subscribe<T>(Action<T> handler)
    {
        if (!eventHandlers.ContainsKey(typeof(T)))
        {
            eventHandlers[typeof(T)] = new List<Delegate>();
        }
        eventHandlers[typeof(T)].Add(handler);
    }

    public static void Unsubscribe<T>(Action<T> handler)
    {
        if (eventHandlers.ContainsKey(typeof(T)))
        {
            eventHandlers[typeof(T)].Remove(handler);
        }
    }

    public static void Publish<T>(T eventData)
    {
        if (eventHandlers.ContainsKey(typeof(T)))
        {
            foreach (var handler in eventHandlers[typeof(T)])
            {
                (handler as Action<T>)?.Invoke(eventData);
            }
        }
    }

    public static void Clear()
    {
        eventHandlers.Clear();
    }
}

public class GameEvents
{
    public class OnBatteryDepleted { }
    public class OnBatteryRecharged { public float amount; }
    public class OnPlayerJumped { }
    public class OnPlayerLanded { }
    public class OnGamePaused { }
    public class OnGameResumed { }
    public class OnGameOver { }
}
