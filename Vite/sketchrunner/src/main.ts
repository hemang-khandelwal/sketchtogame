import './style.css'
import Phaser from 'phaser'

class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle
  private playerBody!: Phaser.Physics.Arcade.Body
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private message!: Phaser.GameObjects.Text
  private won = false

  create() {
    // Create a visible player and give it a moving physics body.
    this.player = this.add.rectangle(80, 490, 30, 40, 0x60a5fa)
    this.physics.add.existing(this.player)
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body

    // Platforms are fixed objects: gravity does not move them.
    const layouts = [
      { x: 0, y: 540, width: 350, height: 60 },
      { x: 280, y: 450, width: 180, height: 20 },
      { x: 500, y: 360, width: 180, height: 20 },
      { x: 720, y: 270, width: 200, height: 20 },
      { x: 700, y: 540, width: 260, height: 60 },
    ]

    const platforms = layouts.map((layout) => {
      const platform = this.add.rectangle(
        layout.x + layout.width / 2,
        layout.y + layout.height / 2,
        layout.width,
        layout.height,
        0x94a3b8,
      )

      this.physics.add.existing(platform, true)
      return platform
    })

    // Stop the player passing through platforms.
    this.physics.add.collider(this.player, platforms)

    // Touching this green rectangle completes the level.
    const finish = this.add.rectangle(870, 245, 30, 50, 0x4ade80)
    this.physics.add.existing(finish, true)

    this.physics.add.overlap(this.player, finish, () => {
      if (this.won) return

      this.won = true
      this.playerBody.setVelocity(0, 0)
      this.playerBody.setAllowGravity(false)
      this.message.setText('Level complete! Press R to restart.')
    })

    this.cursors = this.input.keyboard!.createCursorKeys()

    this.message = this.add.text(
      24,
      24,
      'Arrow keys to move · Space or ↑ to jump · R to restart',
      { fontSize: '18px', color: '#ffffff' },
    )

    this.input.keyboard!.on('keydown-R', () => this.resetPlayer())
  }

  private resetPlayer() {
    this.won = false
    this.playerBody.reset(80, 490)
    this.playerBody.setVelocity(0, 0)
    this.playerBody.setAllowGravity(true)
    this.message.setText(
      'Arrow keys to move · Space or ↑ to jump · R to restart',
    )
  }

  update() {
    if (this.won) return

    // Set horizontal speed according to the held arrow key.
    if (this.cursors.left.isDown) {
      this.playerBody.setVelocityX(-240)
    } else if (this.cursors.right.isDown) {
      this.playerBody.setVelocityX(240)
    } else {
      this.playerBody.setVelocityX(0)
    }

    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.space) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.up)

    // A fresh key press only causes a jump while grounded.
    if (jumpPressed && this.playerBody.blocked.down) {
      this.playerBody.setVelocityY(-460)
    }

    // Reset if the player falls off the level.
    if (
      this.player.y > 700 ||
      this.player.x < -50 ||
      this.player.x > 1010
    ) {
      this.resetPlayer()
    }
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>SketchRunner</h1>
  <p>First prototype: climb the platforms and reach the green marker.</p>
  <div id="game"></div>
`

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 600,
  backgroundColor: '#0f172a',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1000 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  scene: GameScene,
})