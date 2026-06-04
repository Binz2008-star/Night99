using UnityEngine;

public class PlayerMovement : MonoBehaviour
{
    [Header("References")]
    public GameParameters gameParameters;

    [Header("Camera")]
    public Camera playerCamera;

    private Rigidbody rb;
    private Vector3 moveDirection;
    private CharacterController characterController;

    private void OnEnable()
    {
        EventBus.Subscribe<GameEvents.OnGamePaused>(HandleGamePaused);
    }

    private void OnDisable()
    {
        EventBus.Unsubscribe<GameEvents.OnGamePaused>(HandleGamePaused);
    }

    void Start()
    {
        characterController = GetComponent<CharacterController>();
        rb = GetComponent<Rigidbody>();

        if (characterController == null && rb == null)
        {
            Debug.LogError("Neither CharacterController nor Rigidbody found on PlayerMovement script.");
            return;
        }

        if (playerCamera == null)
        {
            playerCamera = Camera.main;
            if (playerCamera == null)
            {
                Debug.LogWarning("No camera assigned or found. Movement may not work correctly.");
            }
        }
    }

    void Update()
    {
        if (GameManager.Instance != null && GameManager.Instance.isPaused) return;

        HandleInput();
    }

    void FixedUpdate()
    {
        if (GameManager.Instance != null && GameManager.Instance.isPaused) return;

        float speed = gameParameters != null ? gameParameters.playerSpeed : 5f;

        if (characterController != null)
        {
            characterController.Move(moveDirection * speed * Time.fixedDeltaTime);
        }
        else if (rb != null)
        {
            rb.MovePosition(rb.position + moveDirection * speed * Time.fixedDeltaTime);
        }
    }

    private void HandleInput()
    {
        float horizontal = Input.GetAxisRaw("Horizontal");
        float vertical = Input.GetAxisRaw("Vertical");

        moveDirection = new Vector3(horizontal, 0f, vertical).normalized;

        if (playerCamera != null)
        {
            Vector3 cameraForward = playerCamera.transform.forward;
            cameraForward.y = 0f;
            cameraForward.Normalize();

            Vector3 cameraRight = playerCamera.transform.right;
            cameraRight.y = 0f;
            cameraRight.Normalize();

            moveDirection = (cameraForward * vertical + cameraRight * horizontal).normalized;
        }
    }

    private void HandleGamePaused(GameEvents.OnGamePaused evt)
    {
        if (rb != null)
        {
            rb.linearVelocity = Vector3.zero;
        }
        moveDirection = Vector3.zero;
    }
}
