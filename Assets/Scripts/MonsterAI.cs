using UnityEngine;

public class MonsterAI : MonoBehaviour
{
    [Header("References")]
    public GameParameters gameParameters;
    public Transform player;
    public Light playerLight;

    [Header("Components")]
    private Rigidbody rb;

    [Header("State")]
    private bool isInLight = false;
    private bool isChasing = false;
    private bool isFleeing = false;
    private float attackCooldown = 0f;

    void Start()
    {
        rb = GetComponent<Rigidbody>();

        if (rb == null)
        {
            rb = gameObject.AddComponent<Rigidbody>();
            rb.useGravity = false;
            rb.constraints = RigidbodyConstraints.FreezeRotation;
        }

        if (player == null)
        {
            player = GameObject.FindGameObjectWithTag("Player")?.transform;
        }

        if (playerLight == null && player != null)
        {
            playerLight = player.GetComponentInChildren<Light>();
        }
    }

    void Update()
    {
        if (GameManager.Instance != null && GameManager.Instance.isPaused) return;
        if (player == null) return;

        CheckLightExposure();
        DetermineBehavior();
    }

    void FixedUpdate()
    {
        if (GameManager.Instance != null && GameManager.Instance.isPaused) return;
        if (player == null) return;

        ExecuteBehavior();
    }

    private void CheckLightExposure()
    {
        if (playerLight == null || !playerLight.enabled)
        {
            isInLight = false;
            return;
        }

        float lightRange = gameParameters != null ? gameParameters.lightRange : 20f;
        float distanceToPlayer = Vector3.Distance(transform.position, player.position);

        isInLight = distanceToPlayer < lightRange && playerLight.enabled;
    }

    private void DetermineBehavior()
    {
        float chaseRange = gameParameters != null ? gameParameters.monsterChaseRange : 30f;
        float fleeLightRange = gameParameters != null ? gameParameters.monsterFleeLightRange : 15f;
        float distanceToPlayer = Vector3.Distance(transform.position, player.position);

        if (isInLight)
        {
            isFleeing = true;
            isChasing = false;
        }
        else if (distanceToPlayer < chaseRange && !isInLight)
        {
            isChasing = true;
            isFleeing = false;
        }
        else
        {
            isChasing = false;
            isFleeing = false;
        }
    }

    private void ExecuteBehavior()
    {
        Vector3 movement = Vector3.zero;

        if (isFleeing)
        {
            Vector3 fleeDirection = (transform.position - player.position).normalized;
            movement = fleeDirection;
        }
        else if (isChasing)
        {
            Vector3 chaseDirection = (player.position - transform.position).normalized;
            movement = chaseDirection;

            CheckForAttack();
        }

        if (movement != Vector3.zero)
        {
            float speed = gameParameters != null ? gameParameters.monsterSpeed : 3f;
            rb.MovePosition(rb.position + movement * speed * Time.fixedDeltaTime);
        }
    }

    private void CheckForAttack()
    {
        float damageRange = gameParameters != null ? gameParameters.monsterDamageRange : 2f;
        float distanceToPlayer = Vector3.Distance(transform.position, player.position);

        if (attackCooldown > 0f)
        {
            attackCooldown -= Time.fixedDeltaTime;
            return;
        }

        if (distanceToPlayer < damageRange && !isInLight)
        {
            AttackPlayer();
            attackCooldown = 1f;
        }
    }

    private void AttackPlayer()
    {
        EventBus.Publish(new GameEvents.OnGameOver());
        Debug.Log("Monster attacked player - Game Over");
    }

    private void OnDrawGizmosSelected()
    {
        float chaseRange = gameParameters != null ? gameParameters.monsterChaseRange : 30f;
        float fleeLightRange = gameParameters != null ? gameParameters.monsterFleeLightRange : 15f;
        float damageRange = gameParameters != null ? gameParameters.monsterDamageRange : 2f;

        Gizmos.color = Color.red;
        Gizmos.DrawWireSphere(transform.position, chaseRange);

        Gizmos.color = Color.yellow;
        Gizmos.DrawWireSphere(transform.position, fleeLightRange);

        Gizmos.color = Color.black;
        Gizmos.DrawWireSphere(transform.position, damageRange);
    }
}
